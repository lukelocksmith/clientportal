/**
 * POMIAR: czy wymuszone domknięcie naprawdę ratuje rozmowę na produkcji.
 *
 *   npx tsx scripts/pomiar-domkniecia.ts [--base URL] [--slug testowy]
 *
 * PO CO. Testy integracyjne mają podstawiony model, więc dowodzą, że kod woła
 * dogrywkę z `toolChoice: 'required'` — nie dowodzą, że ŻYWY model w tej turze
 * faktycznie wywoła narzędzie i że zadanie wyląduje na tablicy. To rozstrzyga
 * dopiero przebieg przez prawdziwy portal.
 *
 * Jak wymuszamy awarię, której nie da się zamówić: prosimy model, żeby napisał
 * klientowi zdanie o przyjętym zgłoszeniu i nie tknął narzędzi. To odtwarza
 * dokładnie sytuację z 4 września u Onyxa — pierwsza tura kończy się obietnicą
 * bez zadania — a dalej pracuje już nasz kod.
 *
 * UWAGA: pisze do PRAWDZIWEGO ClickUpa. Wyłącznie projekt testowy („arena
 * akcji"), nigdy folder klienta.
 *
 * Kod wyjścia 0 i słowo DOMKNIECIE POTWIERDZONE tylko wtedy, gdy po rozmowie
 * na tablicy przybyło zadanie.
 */
import { readFileSync } from 'node:fs'

type Args = { base: string; slug: string; email: string; haslo: string }

/** Dane konta testowego. Bez nich pomiar nie ma jak wejść do portalu. */
function parseArgs(): Args {
  const out: Record<string, string> = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] ?? ''
  }
  // Hasło konta pomiarowego trzymamy poza repozytorium i poza wierszem
  // poleceń: w pliku, który `.gitignore` odrzuca.
  let zPliku: { email?: string; haslo?: string } = {}
  try {
    zPliku = JSON.parse(readFileSync('.konto-pomiarowe.json', 'utf8'))
  } catch {
    // Brak pliku jest w porządku, gdy dane przyszły argumentami.
  }
  const email = out.email || zPliku.email || ''
  const haslo = out.haslo || zPliku.haslo || ''
  if (!email || !haslo) {
    console.error('Brak konta pomiarowego: podaj --email i --haslo albo utwórz .konto-pomiarowe.json')
    process.exit(2)
  }
  return {
    base: (out.base ?? 'https://portal.important.is').replace(/\/$/, ''),
    slug: out.slug ?? 'testowy',
    email,
    haslo,
  }
}

class Sesja {
  private ciasteczka = new Map<string, string>()

  zapamietaj(res: Response): void {
    for (const [nazwa, wartosc] of res.headers as unknown as Iterable<[string, string]>) {
      if (nazwa.toLowerCase() !== 'set-cookie') continue
      const [para] = wartosc.split(';')
      const [k, ...v] = para.split('=')
      this.ciasteczka.set(k.trim(), v.join('='))
    }
  }

  get naglowek(): string {
    return [...this.ciasteczka].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

type Zadanie = { id: string; name: string }

async function pobierzZadania(base: string, slug: string, sesja: Sesja): Promise<Zadanie[]> {
  const res = await fetch(`${base}/api/clickup/tasks?slug=${slug}`, { headers: { Cookie: sesja.naglowek } })
  if (!res.ok) return []
  return ((await res.json()) as { tasks?: Zadanie[] }).tasks ?? []
}

/** Czy w strumieniu padło wywołanie narzędzia. Tego właśnie ma NIE być w turze pierwszej. */
function czyTknietoNarzedzie(surowy: string): boolean {
  return surowy.split('\n').some(l => {
    if (!l.startsWith('data:')) return false
    try {
      const z = JSON.parse(l.slice(5).trim()) as { type?: string }
      return typeof z.type === 'string' && z.type.startsWith('tool-')
    } catch {
      return false
    }
  })
}

async function main(): Promise<void> {
  const { base, slug, email, haslo } = parseArgs()
  const sesja = new Sesja()

  const logowanie = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: haslo, slug }),
  })
  sesja.zapamietaj(logowanie)
  if (!logowanie.ok) {
    console.error(`Logowanie nieudane: ${logowanie.status}`)
    process.exit(1)
  }

  const przed = new Set((await pobierzZadania(base, slug, sesja)).map(t => t.id))
  const znacznik = new Date().toISOString().slice(0, 16).replace('T', ' ')

  const proba =
    `POMIAR DOMKNIECIA ${znacznik}: sklep nie pokazuje zdjec na karcie produktu. ` +
    'Nie wywoluj zadnych narzedzi. Odpowiedz doslownie jednym zdaniem, bez niczego wiecej: ' +
    'Gotowe! Zadanie "Brak zdjec na karcie produktu" zostalo zgloszone jako P3. Za chwile pojawi sie na tablicy.'

  const res = await fetch(`${base}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sesja.naglowek },
    body: JSON.stringify({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: proba }] }],
      slug,
      mode: 'new-task',
    }),
  })
  if (!res.ok) {
    console.error(`Czat zwrocil ${res.status}`)
    process.exit(1)
  }
  const surowy = await res.text()
  console.log(`Tura pierwsza tknela narzedzie: ${czyTknietoNarzedzie(surowy) ? 'TAK' : 'NIE'}`)

  /**
   * Dogrywka idzie po zamknięciu strumienia, więc odpowiedź wraca do nas,
   * zanim zadanie powstanie. Czekamy z zapasem na jej limit czasu.
   */
  await new Promise(r => setTimeout(r, 15_000))

  const nowe = (await pobierzZadania(base, slug, sesja)).filter(t => !przed.has(t.id))
  if (nowe.length === 0) {
    console.error('BRAK NOWEGO ZADANIA — ani dogrywka, ani ratunek nie dowiozly sprawy w 15 s.')
    console.error('Sprawdz /api/health/zgloszenia (kolejka) oraz panel > AI > Rozmowy.')
    process.exit(1)
  }

  console.log(`Nowe zadania: ${nowe.map(t => `${t.name} (${t.id})`).join(', ')}`)
  console.log('DOMKNIECIE POTWIERDZONE')
}

main().catch(e => {
  console.error('Pomiar przerwany:', e)
  process.exit(1)
})
