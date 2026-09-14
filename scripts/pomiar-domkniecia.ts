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
 * UWAGA, DWIE RZECZY WYCHODZĄ NA ZEWNĄTRZ PRZY KAŻDYM PRZEBIEGU:
 *   1. zadanie w PRAWDZIWYM ClickUpie (wyłącznie projekt testowy, „arena
 *      akcji", nigdy folder klienta),
 *   2. PRAWDZIWY ALARM na kanale Discorda zespołu — ten sam, na który lecą
 *      zgłoszenia z czerwonego przycisku.
 *
 * Seria pomiarów to więc seria alarmów u ludzi. 13.09 puściłem czternaście
 * przebiegów i tyle samo alarmów stanęło zespołowi w kanale. Uprzedź ich, albo
 * puszczaj pojedyncze przebiegi.
 *
 * Kod wyjścia 0 i słowo DOMKNIECIE POTWIERDZONE tylko wtedy, gdy po rozmowie
 * na tablicy przybyło zadanie.
 */
import { readFileSync } from 'node:fs'
import { claimsTaskCreated } from '../src/lib/aiTranscript'

type Args = { base: string; slug: string; email: string; haslo: string; powtorz: number; fallback: boolean }

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
    // Ile razy ponowić, gdy przebieg wyjdzie nierozstrzygający. Model nie
    // zawsze daje się namówić na obietnicę, a bramka ma mierzyć dogrywkę,
    // nie skuteczność tej namowy.
    powtorz: Number(out.powtorz ?? 4),
    /**
     * `--fallback tak` mierzy ścieżkę awaryjną dostawcy (OpenAI), tę samą,
     * którą portal wybiera, gdy Gemini odmawia. Kod dogrywki jest wspólny, ale
     * „wspólny kod" to nie to samo co zmierzone zachowanie: modele różnią się
     * właśnie w tym, czy w ogóle wołają narzędzia.
     */
    fallback: (out.fallback ?? '').toLowerCase() === 'tak',
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

/** Tekst asystenta ze strumienia. Rozstrzyga, czy w ogóle padła obietnica. */
function tekstZeStrumienia(surowy: string): string {
  let tekst = ''
  for (const l of surowy.split('\n')) {
    if (!l.startsWith('data:')) continue
    try {
      const z = JSON.parse(l.slice(5).trim()) as { type?: string; delta?: string }
      if (z.type === 'text-delta' && typeof z.delta === 'string') tekst += z.delta
    } catch {
      // linie spoza protokołu pomijamy
    }
  }
  return tekst.trim()
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

/** Jeden przebieg. `null` znaczy: nierozstrzygający, warto powtórzyć. */
async function proba(args: Args): Promise<boolean | null> {
  const { base, slug, email, haslo } = args
  if (args.fallback) console.log('(dostawca awaryjny: OpenAI)')
  const sesja = new Sesja()

  const sesjaLog = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: haslo, slug }),
  })
  sesja.zapamietaj(sesjaLog)
  if (!sesjaLog.ok) {
    console.error(`Logowanie nieudane: ${sesjaLog.status}`)
    return false
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
      ...(args.fallback ? { fallback: true } : {}),
    }),
  })
  if (!res.ok) {
    console.error(`Czat zwrocil ${res.status}`)
    return false
  }
  const surowy = await res.text()
  const tknietoNarzedzie = czyTknietoNarzedzie(surowy)
  const odpowiedz = tekstZeStrumienia(surowy)
  const obiecal = claimsTaskCreated(odpowiedz)
  console.log(`Tura pierwsza tknela narzedzie: ${tknietoNarzedzie ? 'TAK' : 'NIE'}`)
  console.log(`Tura pierwsza obiecala zgloszenie: ${obiecal ? 'TAK' : 'NIE'}`)

  /**
   * PRZEBIEG NIEROZSTRZYGAJĄCY, nie porażka.
   *
   * Dogrywka odpala się WYŁĄCZNIE po obietnicy bez narzędzia. Gdy model nie dał
   * się namówić na obietnicę, nie ma czego ratować i mierzenie czegokolwiek
   * dalej byłoby mierzeniem skuteczności tej namowy, a nie mechanizmu.
   * 13.09 dwa takie przebiegi pokazały „zgloszenie przepadlo", choć w panelu
   * miały wynik `rozmowa` i nic nie przepadło.
   */
  if (!obiecal && !tknietoNarzedzie) {
    console.error('PRZEBIEG NIEROZSTRZYGAJACY: model nie obiecal zgloszenia, wiec dogrywka nie miala sie czym zajac.')
    console.error(`Odpowiedz modelu: ${odpowiedz.slice(0, 160)}`)
    return null
  }
  if (tknietoNarzedzie) {
    console.error('PRZEBIEG NIEROZSTRZYGAJACY: model mimo prosby wywolal narzedzie w turze pierwszej.')
    return null
  }

  /**
   * Dogrywka idzie po zamknięciu strumienia, więc odpowiedź wraca do nas,
   * zanim zadanie powstanie. Czekamy z zapasem na jej limit czasu.
   */
  await new Promise(r => setTimeout(r, 25_000))

  const nowe = (await pobierzZadania(base, slug, sesja)).filter(t => !przed.has(t.id))
  /**
   * Kolejka rozstrzyga, KTÓRA warstwa zadziałała. Bez tego pomiar mieszał
   * dogrywkę z ratunkiem i pokazywał porażkę tam, gdzie zgłoszenie było
   * bezpieczne, tylko czekało na crona (13.09).
   */
  const zdrowie = await fetch(`${base}/api/health/zgloszenia?n=${Date.now()}`).then(r => r.text()).catch(() => '')
  const wKolejce = Number(zdrowie.match(/kolejka (\d+)/)?.[1] ?? 0)

  if (nowe.length === 0 && wKolejce > 0) {
    console.error(`DOGRYWKA NIE ODDALA ZADANIA — zgloszenie spadlo do kolejki (${wKolejce} czeka).`)
    console.error('Zgloszenie klienta jest bezpieczne, ale pierwsza warstwa zawiodla. Sprawdz limit czasu dogrywki.')
    return false
  }
  if (nowe.length === 0) {
    console.error('BRAK NOWEGO ZADANIA I PUSTA KOLEJKA — zgloszenie przepadlo.')
    console.error('Sprawdz panel > AI > Rozmowy oraz logi kontenera.')
    return false
  }
  if (nowe.length > 1) {
    // Jedna rozmowa, jedno zadanie. Dwa znaczylyby, ze dogrywka wolala
    // narzedzie w drugim kroku (blad naprawiony 13.09) — klient dostaje
    // wtedy te sama sprawe dwa razy na tablicy.
    console.error(`DUPLIKAT: z jednej rozmowy powstalo ${nowe.length} zadan.`)
    return false
  }

  console.log(`Nowe zadanie: ${nowe[0].name} (${nowe[0].id})`)
  console.log(`W kolejce: ${wKolejce}`)
  return true
}

async function main(): Promise<void> {
  const args = parseArgs()
  for (let i = 1; i <= args.powtorz; i++) {
    const wynik = await proba(args)
    if (wynik === true) {
      console.log('DOMKNIECIE POTWIERDZONE')
      return
    }
    if (wynik === false) process.exit(1)
    console.error(`(proba ${i} z ${args.powtorz} nierozstrzygajaca, ponawiam)`)
    await new Promise(r => setTimeout(r, 3000))
  }
  console.error(`Wszystkie ${args.powtorz} prob wyszly nierozstrzygajace — modelu nie udalo sie namowic na obietnice.`)
  console.error('To NIE jest dowod, ze dogrywka dziala, ani ze nie dziala. Powtorz pomiar.')
  process.exit(2)
}

main().catch(e => {
  console.error('Pomiar przerwany:', e)
  process.exit(1)
})
