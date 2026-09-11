/**
 * E2E: CZY ZGŁOSZENIE Z CZATU NAPRAWDĘ DOCHODZI DO CLICKUPA.
 *
 *   node --env-file=.env.local --import tsx scripts/e2e-zgloszenie-z-czatu.ts \
 *     --base https://portal.important.is --slug testowy \
 *     --email KONTO --haslo HASLO
 *
 * PO CO, skoro są `czy-zadanie-powstaje.ts` i testy integracyjne. Tamte mają
 * PODSTAWIONE narzędzie albo podstawiony model, więc mierzą kawałki łańcucha.
 * 4 września u Onyxa pękł łańcuch JAKO CAŁOŚĆ: model odpowiedział klientce, że
 * zgłoszenie jest zapisane, narzędzia nie tknął, zadanie nie powstało nigdzie,
 * a wszystkie nasze zielone testy nadal były zielone. Ten skrypt idzie całą
 * drogą, którą przechodzi klient, i pyta na końcu o to, co klient sprawdza:
 * CZY SPRAWA JEST NA TABLICY.
 *
 * Etapy, każdy sprawdzany osobno:
 *   1. logowanie do portalu prawdziwym kontem,
 *   2. rozmowa z asystentem przez `/api/ai/chat` — prawdziwy model,
 *   3. odczyt zadań portalu z ClickUpa — czy zadanie widać na tablicy,
 *   4. gdy nie widać: odczyt kolejki i zapisu rozmowy, żeby nazwać awarię.
 *
 * UWAGA: to jest zapis do PRAWDZIWEGO ClickUpa. Uruchamiaj wyłącznie na
 * projekcie testowym („arena akcji"), nigdy na folderze klienta.
 *
 * Kod wyjścia: 0 gdy zadanie jest na tablicy albo czeka w kolejce po awarii
 * ClickUpa; 1 gdy zgłoszenie przepadło albo asystent skłamał klientowi.
 */

type Args = { base: string; slug: string; email: string; haslo: string; adminToken?: string }

function parseArgs(): Args {
  const out: Record<string, string> = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] ?? ''
  }
  const base = out.base ?? 'http://localhost:3000'
  const slug = out.slug ?? 'testowy'
  if (!out.email || !out.haslo) {
    console.error('Podaj --email i --haslo konta klienta w tym portalu.')
    process.exit(2)
  }
  return { base: base.replace(/\/$/, ''), slug, email: out.email, haslo: out.haslo, adminToken: out.adminToken }
}

/** Ciasteczka trzymamy sami: portal identyfikuje sesję ciasteczkiem. */
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

/** Jedna wypowiedź klienta w formacie, którego oczekuje trasa czatu. */
const wiadomosc = (text: string, role: 'user' | 'assistant' = 'user') => ({
  id: Math.random().toString(36).slice(2),
  role,
  parts: [{ type: 'text', text }],
})

/**
 * Odpowiedź trasy czatu jest strumieniem zdarzeń SDK. Interesuje nas z niego
 * tylko tekst asystenta i to, czy padło wywołanie narzędzia — bo właśnie
 * rozjazd między tymi dwiema rzeczami jest awarią, której szukamy.
 */
async function przeczytajStrumien(res: Response): Promise<{ tekst: string; narzedzie: boolean }> {
  const surowy = await res.text()
  let tekst = ''
  let narzedzie = false
  for (const linia of surowy.split('\n')) {
    const dane = linia.startsWith('data:') ? linia.slice(5).trim() : ''
    if (!dane || dane === '[DONE]') continue
    try {
      const zdarzenie = JSON.parse(dane) as { type?: string; delta?: string; toolName?: string }
      if (zdarzenie.type === 'text-delta' && typeof zdarzenie.delta === 'string') tekst += zdarzenie.delta
      if (typeof zdarzenie.type === 'string' && zdarzenie.type.startsWith('tool-')) narzedzie = true
      if (zdarzenie.toolName === 'createTask') narzedzie = true
    } catch {
      // Linie spoza protokołu pomijamy: to nie jest parser SDK, tylko podgląd.
    }
  }
  return { tekst: tekst.trim(), narzedzie }
}

type Zadanie = { id: string; name: string }

/** Zadania widoczne dla klienta na tablicy portalu. */
async function pobierzZadania(base: string, slug: string, sesja: Sesja): Promise<Zadanie[]> {
  const res = await fetch(`${base}/api/clickup/tasks?slug=${slug}`, { headers: { Cookie: sesja.naglowek } })
  if (!res.ok) return []
  const dane = (await res.json()) as { tasks?: Zadanie[] }
  return dane.tasks ?? []
}

async function main(): Promise<void> {
  const { base, slug, email, haslo } = parseArgs()
  const sesja = new Sesja()
  const stempel = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const temat = `E2E ${stempel}: baner na stronie glownej do podmiany`

  console.log(`\n== 1. Logowanie do ${base}/${slug} jako ${email}`)
  const logowanie = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: haslo, slug }),
  })
  sesja.zapamietaj(logowanie)
  if (!logowanie.ok) {
    console.error(`   NIE: logowanie zwrocilo ${logowanie.status} ${await logowanie.text()}`)
    process.exit(1)
  }
  console.log('   OK')

  /**
   * Zdjęcie tablicy PRZED rozmową. Rozpoznanie „naszego" zadania po nazwie nie
   * działa: nazwę wymyśla model, więc stempel z tego skryptu do niej nie trafia
   * (przebieg 11.09 uznał udane zgłoszenie za porażkę, bo zadanie nazywało się
   * „Podmiana grafiki banera na stronie głównej"). Porównanie zbiorów id jest
   * odporne na dowolną nazwę.
   */
  const przed = new Set((await pobierzZadania(base, slug, sesja)).map(t => t.id))
  console.log(`   zadan na tablicy przed proba: ${przed.size}`)

  /**
   * Rozmowa prowadzona tak, jak prowadziła ją klientka Onyxa: opis sprawy,
   * polecenie „zgłoś to jako zadanie", potem samo „tak" na pytanie o poziom.
   * Właśnie na tym ostatnim „tak" model 4 września napisał „Gotowe" i nie
   * zrobił nic.
   *
   * Replik jest osiem, choć prompt ma twardy limit czterech pytań: pierwszy
   * przebieg 11.09 pokazał, że model potrafi zadać piąte i szóste. Krótsza
   * lista kończyłaby się wynikiem „rozmowa się nie domknęła" i test mierzyłby
   * cierpliwość skryptu zamiast drogi zgłoszenia. Pętla i tak przerywa się
   * z chwilą wywołania narzędzia.
   */
  const repliki = [
    `${temat}. Chcemy podmienic grafike w sekcji na gorze strony glownej.`,
    'Adres to https://important.is, sekcja na samej gorze.',
    'Ma sie zmienic sama grafika, tekst zostaje bez zmian. Grafike mamy gotowa.',
    'zglos to jako zadanie',
    'tak',
    'tak, potwierdzam',
    'tak, zglos to prosze',
    'tak',
  ]

  console.log('\n== 2. Rozmowa z asystentem (prawdziwy model)')
  const historia: ReturnType<typeof wiadomosc>[] = []
  let ostatniTekst = ''
  let bylowywolanie = false

  for (const replika of repliki) {
    historia.push(wiadomosc(replika))
    const res = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sesja.naglowek },
      body: JSON.stringify({ messages: historia, slug, mode: 'new-task' }),
    })
    if (!res.ok) {
      console.error(`   NIE: czat zwrocil ${res.status} ${await res.text()}`)
      process.exit(1)
    }
    const { tekst, narzedzie } = await przeczytajStrumien(res)
    bylowywolanie = bylowywolanie || narzedzie
    ostatniTekst = tekst
    historia.push(wiadomosc(tekst, 'assistant'))
    console.log(`   klient:   ${replika}`)
    console.log(`   asystent: ${tekst.slice(0, 160)}${tekst.length > 160 ? '…' : ''}`)
    if (narzedzie) {
      console.log('   >> asystent wywolal narzedzie tworzenia zadania')
      break
    }
  }

  /**
   * Kolejka dowozi z opóźnieniem (cron), a ratunek porzuconego zgłoszenia
   * zapisuje się po zamknięciu strumienia. Chwila przerwy, żeby nie czytać
   * stanu sprzed zapisu.
   */
  await new Promise(r => setTimeout(r, 4000))

  console.log('\n== 3. Czy zadanie widac na tablicy klienta')
  const nasze = (await pobierzZadania(base, slug, sesja)).filter(t => !przed.has(t.id))

  if (nasze.length > 0) {
    console.log(`   OK: ${nasze.map(t => `${t.name} (${t.id})`).join(', ')}`)
    console.log('\nWYNIK: zgloszenie przeszlo cala droge do ClickUpa.')
    return
  }

  console.log('   NIE MA na tablicy.')
  console.log('\n== 4. Diagnoza')
  console.log(`   wywolanie narzedzia w strumieniu: ${bylowywolanie ? 'BYLO' : 'NIE BYLO'}`)
  console.log(`   ostatnie zdanie asystenta: ${ostatniTekst.slice(0, 200)}`)

  const { claimsTaskCreated } = await import('../src/lib/aiTranscript')
  if (!bylowywolanie && claimsTaskCreated(ostatniTekst)) {
    console.error(
      '\nWYNIK: ASYSTENT SKLAMAL KLIENTOWI. Obiecal zgloszenie, narzedzia nie tknal.\n' +
        'Sprawdz, czy ratunek odlozyl sprawe do kolejki: /api/health/zgloszenia oraz panel > AI > Rozmowy.'
    )
    process.exit(1)
  }

  console.error(
    '\nWYNIK: zadania nie ma. Jesli asystent dalej dopytywal, to nie jest awaria,\n' +
      'tylko rozmowa, ktora sie nie domknela — powtorz z bardziej jednoznacznymi odpowiedziami.'
  )
  process.exit(1)
}

main().catch(e => {
  console.error('Przebieg przerwany:', e)
  process.exit(1)
})
