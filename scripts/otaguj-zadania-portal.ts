/**
 * KROK 1 wdrożenia filtra „tylko zadania z tagiem portal" (lib/portalVisibility.ts):
 * otagowanie zadań, które klient widzi dziś i powinien widzieć dalej.
 *
 * DOMYŚLNIE NIC NIE ZAPISUJE (dry-run). Wypisuje per projekt: co zostanie
 * otagowane, co zostaje ukryte (scripts/dane/portal-wykluczone.json) i gdzie
 * wykluczenie nie zadziała, bo zadanie odziedziczy widoczność po rodzicu.
 *
 *   node --env-file=.env.local --import tsx scripts/otaguj-zadania-portal.ts \
 *     --portale portale.json [--slug onyx --slug eff] [--apply]
 *
 * Źródło projektów:
 *   --portale plik.json   [{ "slug", "folderId", "spaceId", "lists": ["..."] }]
 *                          (odczyt z bazy produkcyjnej zrobiony osobno, SELECT-em)
 *   bez --portale          tabele portals + portal_lists z DATABASE_URL
 *
 * --apply
 *   - wymaga co najmniej jednego --slug (żadnego „wszystko naraz"),
 *   - przerywa, gdy tagu `portal` nie ma w słowniku przestrzeni (ClickUp
 *     pomija nieznane tagi po cichu),
 *   - przerywa projekt, gdy pobór z ClickUpa był ucięty albo plan ma konflikty,
 *   - po każdym zapisie czyta zadanie GET-em i sprawdza, że tag NAPRAWDĘ jest.
 *     Kod 2xx nie jest dowodem. Kończy się kodem 1, gdy choć jedno zadanie
 *     nie przeszło weryfikacji.
 *
 * Czego NIE robi: nie zdejmuje tagów, nie zakłada tagu w przestrzeni, nie
 * włącza flagi projektu. To osobne decyzje.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

type PortalInput = { slug: string; folderId: string; spaceId: string; lists: string[] }
type Exclusions = Record<string, Array<{ id: string; powod: string }>>

const DELAY_MS = Number(process.env.CLICKUP_SYNC_DELAY_MS ?? 800)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function parseArgs(argv: string[]) {
  const slugs: string[] = []
  let portale: string | null = null
  let apply = false
  let wykluczone = path.resolve(process.cwd(), 'scripts/dane/portal-wykluczone.json')
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') apply = true
    else if (a === '--slug') slugs.push(argv[++i])
    else if (a === '--portale') portale = argv[++i]
    else if (a === '--wykluczone') wykluczone = argv[++i]
    else throw new Error(`Nieznany argument: ${a}`)
  }
  return { slugs, portale, apply, wykluczone }
}

async function loadPortals(file: string | null): Promise<PortalInput[]> {
  if (file) return JSON.parse(readFileSync(file, 'utf8')) as PortalInput[]
  const { db } = await import('../src/lib/db')
  const { portals, portalLists } = await import('../src/lib/db/schema')
  const rows = await db.select().from(portals)
  const lists = await db.select().from(portalLists)
  return rows.map(p => ({
    slug: p.slug,
    folderId: p.clickupFolderId,
    spaceId: p.clickupSpaceId,
    lists: lists.filter(l => l.portalId === p.id).map(l => l.clickupListId),
  }))
}

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.apply && args.slugs.length === 0) {
    console.error('--apply wymaga --slug. Przerywam, niczego nie zapisałem.')
    process.exit(1)
  }

  const clickup = await import('../src/lib/clickup')
  const { filterTasksToScope } = await import('../src/lib/portalScope')
  const { planPortalTagging } = await import('../src/lib/portalTagging')
  const { PORTAL_VISIBILITY_TAG, hasPortalTag } = await import('../src/lib/portalVisibility')

  // Klucze z podkreślnikiem (`_opis`, `_do_wyczyszczenia_opisu`) to notatki, nie projekty.
  const exclusions = JSON.parse(readFileSync(args.wykluczone, 'utf8')) as Exclusions
  const all = await loadPortals(args.portale)
  const selected = args.slugs.length > 0 ? all.filter(p => args.slugs.includes(p.slug)) : all
  const missing = args.slugs.filter(s => !all.some(p => p.slug === s))
  if (missing.length > 0) {
    console.error(`Nie ma projektów: ${missing.join(', ')}. Przerywam.`)
    process.exit(1)
  }

  console.log(`TRYB: ${args.apply ? 'APPLY (zapis w ClickUpie)' : 'DRY-RUN (bez zapisu)'}`)
  let failures = 0

  for (const portal of selected) {
    const { tasks: folder, truncated } = await clickup.getFolderTaskHistory(portal.folderId)
    const tasks = filterTasksToScope(folder, portal.lists)
    const reasons = new Map((exclusions[portal.slug] ?? []).map(e => [e.id, e.powod]))
    const plan = planPortalTagging(tasks, new Set(reasons.keys()))
    const byId = new Map(tasks.map(t => [t.id, t]))

    console.log(`\n=== ${portal.slug} (folder ${portal.folderId}, listy: ${portal.lists.join(', ') || 'cały folder'})`)
    console.log(`widzi dziś: ${plan.visibleToday} zadań (z podzadaniami, także zamknięte w Historii)`)
    console.log(`po włączeniu flagi zobaczy: ${plan.visibleAfter}`)
    console.log(`do otagowania (korzenie): ${plan.toTag.length}, już z tagiem: ${plan.alreadyTagged.length}, wykluczone korzenie: ${plan.excluded.length}`)
    if (truncated) console.log('UWAGA: pobór z ClickUpa UCIĘTY, plan niepełny.')

    for (const t of plan.toTag) {
      const st = (byId.get(t.id) as { status?: { status?: string } } | undefined)?.status?.status ?? '?'
      console.log(`  + ${t.id}  [${st}]  ${short(t.name)}`)
    }
    for (const t of plan.excluded) {
      console.log(`  - ${t.id}  UKRYTE: ${short(t.name, 60)}  (${reasons.get(t.id)})`)
    }
    for (const c of plan.conflicts) {
      console.log(`  ! ${c.task.id}  KONFLIKT: wykluczone, ale widoczne przez ${c.visibleVia} (${short(c.task.name, 50)})`)
    }
    for (const id of plan.unknownExclusions) {
      console.log(`  ? ${id}  wykluczenie spoza zakresu tego projektu (usunięte? literówka?)`)
    }

    if (!args.apply) continue

    if (truncated || plan.conflicts.length > 0) {
      console.error(`[${portal.slug}] Ucięty pobór albo konflikty w planie. Pomijam zapis dla tego projektu.`)
      failures++
      continue
    }
    const spaceTags = await clickup.getSpaceTags(portal.spaceId)
    if (!spaceTags.some(t => t.toLowerCase() === PORTAL_VISIBILITY_TAG)) {
      console.error(
        `[${portal.slug}] Tagu "${PORTAL_VISIBILITY_TAG}" nie ma w przestrzeni ${portal.spaceId}. ` +
          'Załóż go w ClickUpie i uruchom ponownie. Niczego nie zapisałem.'
      )
      process.exit(1)
    }

    for (const t of plan.toTag) {
      try {
        await clickup.addTaskTag(t.id, PORTAL_VISIBILITY_TAG)
        await sleep(DELAY_MS)
        const check = await clickup.getTask(t.id)
        if (hasPortalTag(check)) {
          console.log(`  OK ${t.id}`)
        } else {
          console.error(`  BRAK TAGU po zapisie: ${t.id} (ClickUp odpowiedział sukcesem, tag nie istnieje)`)
          failures++
        }
      } catch (e) {
        console.error(`  BŁĄD ${t.id}: ${e instanceof Error ? e.message : String(e)}`)
        failures++
      }
      await sleep(DELAY_MS)
    }
  }

  if (args.apply) console.log(`\nKoniec. Nieudanych: ${failures}.`)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
