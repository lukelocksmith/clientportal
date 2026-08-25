/**
 * Przenosi stawki godzinowe z CRM (Notion) do portalu.
 *
 * DLACZEGO KOPIA, A NIE ODPYTYWANIE NA ŻYWO: raport czasu pracy to strona
 * KLIENTA. Gdyby portal pytał Notion przy każdym otwarciu, awaria albo limit
 * cudzego API zabierałby klientowi raport, a stawki zmieniają się parę razy
 * w roku. Notion zostaje źródłem prawdy, portal trzyma jego kopię.
 *
 * DLACZEGO SKRYPT, A NIE CRON W APLIKACJI: produkcja nie musi wtedy znać
 * tokenu do Notion ani mieć do niego dostępu sieciowego. Mniej sekretów na
 * serwerze i jedna zależność mniej na ścieżce klienta.
 *
 * ŁĄCZENIE: po identyfikatorze folderu ClickUp. Baza „B: PROJEKT" ma kolumnę
 * `ID clickup`, a portal `clickup_folder_id` — to ten sam numer, więc nie
 * dopasowujemy po nazwach, które w obu systemach bywają inne („wdf" kontra
 * „Wodadlafirmy").
 *
 * URUCHOMIENIE (podgląd, nic nie zapisuje):
 *   npx tsx -r dotenv/config scripts/sync-stawki-notion.ts dotenv_config_path=.env.local
 *
 * ZAPIS:
 *   npx tsx -r dotenv/config scripts/sync-stawki-notion.ts --zapisz dotenv_config_path=.env.local
 *
 * Token: NOTION_API_TOKEN (z ~/.claude/keys.env albo .env.local).
 */
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { portals } from '../src/lib/db/schema'
import { formatujStawke } from '../src/lib/money'

/** Baza „B: PROJEKT" w Notion: nazwa projektu, `Godzinówka`, `ID clickup`. */
const BAZA_PROJEKTY = 'e237c852-46fe-4ed0-bc6c-58b303eff615'

type Projekt = { nazwa: string; folderId: string; stawkaZl: number | null }

async function pobierzProjekty(token: string): Promise<Projekt[]> {
  const out: Projekt[] = []
  let cursor: string | undefined

  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${BAZA_PROJEKTY}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 }),
    })
    const json = await res.json()
    if (json.object === 'error') throw new Error(`Notion: ${json.message}`)

    for (const p of json.results ?? []) {
      const nazwa = (p.properties?.['Name']?.title ?? []).map((x: { plain_text: string }) => x.plain_text).join('')
      const f = p.properties?.['ID clickup']?.formula
      const folderId = f ? String(f.string ?? f.number ?? '') : ''
      const stawkaZl = p.properties?.['Godzinówka']?.number ?? null
      if (folderId) out.push({ nazwa, folderId, stawkaZl })
    }

    cursor = json.has_more ? json.next_cursor : undefined
  } while (cursor)

  return out
}

async function main() {
  const token = process.env.NOTION_API_TOKEN
  if (!token) {
    console.error('Brak NOTION_API_TOKEN. Dodaj go do .env.local albo wczytaj z ~/.claude/keys.env.')
    process.exit(1)
  }

  const zapis = process.argv.includes('--zapisz')
  const projekty = await pobierzProjekty(token)
  const poFolderze = new Map(projekty.map(p => [p.folderId, p]))

  const nasze = await db
    .select({
      id: portals.id,
      slug: portals.slug,
      folderId: portals.clickupFolderId,
      teraz: portals.hourlyRateNet,
    })
    .from(portals)

  console.log(`Projektów w CRM z ID clickup: ${projekty.length}`)
  console.log(zapis ? '=== ZAPIS ===' : '=== PODGLĄD (bez zapisu, dodaj --zapisz) ===')

  let zmienione = 0
  for (const portal of nasze) {
    const crm = poFolderze.get(portal.folderId)

    if (!crm) {
      console.log(`  ${portal.slug.padEnd(12)} — brak w CRM, zostawiam bez zmian`)
      continue
    }
    if (crm.stawkaZl == null) {
      console.log(`  ${portal.slug.padEnd(12)} — „${crm.nazwa}" bez stawki w CRM, zostawiam bez zmian`)
      continue
    }

    const grosze = Math.round(crm.stawkaZl * 100)
    if (grosze === portal.teraz) {
      console.log(`  ${portal.slug.padEnd(12)} = ${formatujStawke(grosze)} (bez zmian)`)
      continue
    }

    const bylo = portal.teraz == null ? 'brak' : formatujStawke(portal.teraz)
    console.log(`  ${portal.slug.padEnd(12)} ${bylo} → ${formatujStawke(grosze)}   [${crm.nazwa}]`)

    if (zapis) {
      await db.update(portals).set({ hourlyRateNet: grosze }).where(eq(portals.id, portal.id))
    }
    zmienione++
  }

  console.log(zapis ? `\nZapisano zmian: ${zmienione}` : `\nDo zmiany: ${zmienione}. Dodaj --zapisz, żeby wykonać.`)
  process.exit(0)
}

main().catch(e => {
  console.error('Nie udało się zsynchronizować stawek:', e)
  process.exit(1)
})
