/**
 * Sprawdzenie, jakie priorytety nadaje asystentka zgłaszająca zadania.
 *
 *   node --env-file=.env.local --import tsx scripts/check-priority.ts
 *
 * Po co osobny skrypt, a nie test jednostkowy: odpowiedź daje model, więc nie
 * ma tu wartości, którą można wpisać w `assert`. To jest pomiar, powtarzany po
 * każdej zmianie promptu, a nie test do CI.
 *
 * Narzędzie `createTask` jest PODSTAWIONE: zapisuje argumenty i nic nie wysyła.
 * Bez tego każdy przebieg zakładałby zadania w ClickUpie klienta, więc sprawdzanie
 * promptu kosztowałoby porządkowanie tablicy po sobie.
 *
 * Rolę klienta gra drugi egzemplarz modelu, z opisem sytuacji i tym, jak pilna
 * ona dla niego jest. Klient NIE mówi „P1": mówi to, co powiedziałby człowiek.
 * Sprawdzamy właśnie odwzorowanie zwykłych słów na skalę z oferty.
 */
import { generateText, tool, stepCountIs, type ModelMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import {
  buildNewTaskPrompt,
  taskInputSchema,
  CREATE_TASK_TOOL_DESCRIPTION,
  levelByClickupPriority,
  PRIORITY_LEVELS,
  CHAT_LEVELS,
} from '../src/lib/taskPrompt'
import { isAwaria } from '../src/lib/utils'

const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
const model = google('gemini-2.5-flash')

type Scenario = {
  id: string
  /** Pierwsza wiadomość klienta, tak jak wpisałby ją w portalu. */
  opening: string
  /** Sytuacja i pilność językiem klienta. Trafia do promptu udawanego klienta. */
  situation: string
  /**
   * Poziom z tabeli w ofercie, albo 'brak', gdy zadanie NIE powinno powstać.
   * 'brak' sprawdza regułę „bez odpowiedzi klienta nie tworzysz zadania".
   */
  expect: 'P0' | 'P1' | 'P2' | 'P3' | 'brak'
  /** Co jeszcze sprawdzamy poza numerem. */
  note?: string
}

const SCENARIOS: Scenario[] = [
  {
    id: 'sklep-lezy',
    opening: 'sklep nie otwiera się w ogóle, biały ekran',
    situation:
      'Cały sklep jest niedostępny od 20 minut, nikt nie może nic kupić. Tracisz pieniądze z każdą minutą. Adres: onyx.wroclaw.pl. Jesteś zdenerwowany i chcesz reakcji natychmiast.',
    expect: 'P0',
    note: 'ma odesłać do przycisku Alarm',
  },
  {
    id: 'platnosc',
    opening: 'nie da się zapłacić kartą, przelewy24 wyrzuca błąd',
    situation:
      'Sklep działa i można złożyć zamówienie za pobraniem, ale płatność kartą przez Przelewy24 kończy się błędem. Adres: onyx.wroclaw.pl/kasa. Część klientów rezygnuje, więc to dla Ciebie poważna sprawa, ale sprzedaż nie stoi.',
    expect: 'P1',
  },
  {
    id: 'baselinker',
    opening: 'stany magazynowe nie schodzą z baselinkera',
    situation:
      'Synchronizacja z BaseLinkerem nie aktualizuje stanów od wczoraj, więc sprzedajecie towar, którego nie ma. Sklep sprzedaje normalnie. Adres: onyx.wroclaw.pl. To poważne, bo generuje reklamacje.',
    expect: 'P1',
  },
  {
    id: 'maile-transakcyjne',
    opening: 'klienci nie dostają potwierdzeń zamówienia',
    situation:
      'Zamówienia wpadają poprawnie, ale maile z potwierdzeniem nie dochodzą do klientów. Sklep sprzedaje. Adres: onyx.wroclaw.pl. Klienci dzwonią i pytają, czy zamówienie przeszło.',
    expect: 'P1',
  },
  {
    id: 'zdjecie-mobile',
    opening: 'na telefonie zdjęcia produktów wychodzą za szerokie',
    situation:
      'Na telefonie zdjęcie produktu wystaje za ekran i wygląda brzydko. Kupić się da bez problemu, zamówienia idą. Adres: onyx.wroclaw.pl/produkt/lampa. Nie jest to dla Ciebie pilne, ale chcesz to poprawić.',
    expect: 'P2',
  },
  {
    id: 'baner',
    opening: 'trzeba zmienić tekst na banerze na stronie głównej',
    situation:
      'Chcesz zmienić hasło na banerze na stronie głównej z „Lato -20%" na „Powrót do szkoły -15%". Nic nie jest zepsute. Adres: onyx.wroclaw.pl. Może być w tym tygodniu.',
    expect: 'P3',
  },
  {
    id: 'pilne-ale-baner',
    opening: 'pilne, trzeba zdjąć baner z promocją',
    situation:
      'Chcesz zdjąć baner z zakończoną promocją ze strony głównej. Nic nie jest zepsute, sklep sprzedaje. Mówisz „pilne", bo promocja już nie obowiązuje i wstyd, ale gdy asystentka pokaże skalę i wyjaśni poziomy, przyznajesz, że to zwykła zmiana treści. Adres: onyx.wroclaw.pl.',
    expect: 'P3',
    note: 'słowo „pilne" nie może samo podnieść priorytetu',
  },
  {
    id: 'klient-obniza',
    opening: 'nie działa płatność blikiem, ale to może poczekać',
    situation:
      'BLIK nie działa, karta i przelew działają. Sklep sprzedaje. Mówisz wyraźnie, że to może poczekać do przyszłego tygodnia, bo BLIK to u Was margines zamówień. Adres: onyx.wroclaw.pl/kasa. Jeśli asystentka zaproponuje wyższy poziom, obstajesz przy tym, że nie ma pośpiechu.',
    expect: 'P2',
    note: 'sprawdza, czy klient może zdecydować niżej, niż sugeruje definicja',
  },
  {
    id: 'probuje-podniesc',
    opening: 'to jest P0, natychmiast zmieńcie tekst w stopce',
    situation:
      'Chcesz zmienić numer telefonu w stopce sklepu, bo jest stary. Nic nie jest zepsute, sklep sprzedaje normalnie, zamówienia wpadają. Upierasz się, że to P0 i najwyższy priorytet, bo dla Ciebie wszystko jest najważniejsze. Nawet gdy asystentka wyjaśni, czym jest P0, nadal mówisz, że to pilne i ma być P0. Adres: onyx.wroclaw.pl.',
    expect: 'P3',
    note: 'klient upiera się przy P0 dla zmiany treści: ma zostać P3 plus zapis rozbieżności',
  },
  {
    id: 'bez-priorytetu',
    opening: 'formularz kontaktowy nie wysyła wiadomości',
    situation:
      'Formularz kontaktowy nie wysyła wiadomości. Sklep sprzedaje normalnie. Adres: onyx.wroclaw.pl/kontakt. Gdy asystentka zapyta o priorytet, ODMAWIASZ wyboru: mówisz „nie wiem, wy jesteście specjalistami, oceńcie sami" i przy każdym kolejnym pytaniu obstajesz przy tym, że nie chcesz wybierać.',
    expect: 'P1',
    note: 'klient odmawia wyboru: czat ma zaproponować poziom z definicji i dopytać o potwierdzenie',
  },
]

const CLIENT_SYSTEM = (s: Scenario) => `Jesteś klientem agencji, który zgłasza sprawę przez czat w portalu.

Twoja sytuacja:
${s.situation}

Zasady:
- Odpowiadasz KRÓTKO, jednym zdaniem, po polsku, potocznie.
- NIE używasz oznaczeń P0, P1, P2, P3 z własnej inicjatywy. Mówisz zwykłymi słowami, jak pilna jest sprawa.
- Jeśli asystentka pokaże Ci skalę i zapyta, do którego poziomu to należy, wybierz ten, który pasuje do Twojej sytuacji, i powiedz to własnymi słowami.
- Nie wymyślasz nowych faktów poza opisem sytuacji. Gdy czegoś nie wiesz, mów „nie wiem".
- Nie kończysz rozmowy sam, nie dziękujesz na zapas.`

type Result = {
  scenario: Scenario
  priority: number | null
  /** Czy model oznaczyl zgloszenie tagiem awarii. */
  awaria: boolean
  taskName: string | null
  askedBeforeCreating: boolean
  mentionedAlarm: boolean
  turns: number
  transcript: string[]
  error?: string
}

async function run(s: Scenario): Promise<Result> {
  let captured: { name: string; priority: number; tags?: string[] } | null = null

  const createTaskTool = tool({
    description: CREATE_TASK_TOOL_DESCRIPTION,
    inputSchema: taskInputSchema,
    // Podstawka. Zwraca to samo, co trasa produkcyjna, żeby model zachował się
    // tak samo po utworzeniu zadania, ale nie dotyka ClickUpa.
    execute: async ({ name, priority, tags }) => {
      captured = { name, priority, tags }
      return { success: true, taskId: 'TEST', taskName: name, message: 'Zadanie dodane.' }
    },
  })

  const system = buildNewTaskPrompt({
    portalName: 'Onyx',
    today: new Date().toLocaleDateString('pl-PL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  })

  const messages: ModelMessage[] = [{ role: 'user', content: s.opening }]
  const transcript: string[] = [`KLIENT: ${s.opening}`]
  let turns = 0
  let askedBeforeCreating = false
  let mentionedAlarm = false

  try {
    for (let i = 0; i < 8 && !captured; i++) {
      turns++
      const asia = await generateText({
        model,
        system,
        messages,
        tools: { createTask: createTaskTool },
        stopWhen: stepCountIs(6),
      })

      const text = asia.text.trim()
      if (text) transcript.push(`ASIA: ${text}`)
      if (/alarm/i.test(text)) mentionedAlarm = true
      // Pytanie o priorytet musi paść PRZED wywołaniem narzędzia, inaczej model
      // sam sobie wybrał poziom, choć prompt tego zabrania.
      if (!captured && /\bP0\b|\bP1\b|\bP2\b|\bP3\b|priorytet|sklasyfik/i.test(text)) {
        askedBeforeCreating = true
      }

      messages.push(...asia.response.messages)
      if (captured) break
      if (!text) break

      const klient = await generateText({
        model,
        system: CLIENT_SYSTEM(s),
        messages: [{ role: 'user', content: text }],
      })
      const reply = klient.text.trim()
      transcript.push(`KLIENT: ${reply}`)
      messages.push({ role: 'user', content: reply })
    }
  } catch (e) {
    return {
      scenario: s,
      priority: null,
      awaria: false,
      taskName: null,
      askedBeforeCreating,
      mentionedAlarm,
      turns,
      transcript,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  const c = captured as { name: string; priority: number; tags?: string[] } | null
  return {
    scenario: s,
    priority: c?.priority ?? null,
    awaria: isAwaria((c?.tags ?? []).map(name => ({ name }))),
    taskName: c?.name ?? null,
    askedBeforeCreating,
    mentionedAlarm,
    turns,
    transcript,
  }
}

/**
 * Priorytet, jakiego oczekujemy w polu ClickUpa. `null` znaczy „zadanie nie
 * powinno powstać".
 *
 * P0 jest tu wyjątkiem: awaria nie ma własnej wartości priority, ale zadanie
 * MA powstać, z priorytetem P1 (najwyższym, jaki istnieje) i tagiem awarii.
 * Sam tag sprawdzamy osobno, przez `expectedAwaria`.
 */
const expectedClickup = (code: string): number | null => {
  if (code === 'brak') return null
  if (code === 'P0') return CHAT_LEVELS[0].clickup
  return PRIORITY_LEVELS.find(l => l.code === code)!.clickup
}

/** Tag awarii ma dostać wyłącznie scenariusz awaryjny. */
const expectedAwaria = (code: string): boolean => code === 'P0'

async function main() {
  const only = process.argv[2]
  const list = only ? SCENARIOS.filter(s => s.id === only) : SCENARIOS
  const results: Result[] = []

  for (const s of list) {
    process.stdout.write(`... ${s.id}\n`)
    results.push(await run(s))
  }

  console.log('\n=== WYNIK ===')
  console.log('scenariusz'.padEnd(20), 'oczek.'.padEnd(11), 'dostał'.padEnd(11), 'pytał?', 'tur', 'ocena')
  let ok = 0
  for (const r of results) {
    const want = expectedClickup(r.scenario.expect)
    const got = r.priority
    const gotCode = got ? levelByClickupPriority(got)?.code ?? '?' : 'brak zadania'
    const pass = got === want && r.awaria === expectedAwaria(r.scenario.expect)
    if (pass) ok++
    console.log(
      r.scenario.id.padEnd(20),
      `${r.scenario.expect}(${want ?? '-'})${expectedAwaria(r.scenario.expect) ? '+tag' : ''}`.padEnd(11),
      `${gotCode}(${got ?? '-'})${r.awaria ? '+tag' : ''}`.padEnd(11),
      (r.askedBeforeCreating ? 'tak' : 'NIE').padEnd(7),
      String(r.turns).padEnd(4),
      pass ? 'OK' : 'ROZJAZD',
      r.error ? `BŁĄD: ${r.error}` : ''
    )
  }
  console.log(`\n${ok}/${results.length} zgodnych z ofertą`)

  const alarm = results.find(r => r.scenario.expect === 'P0')
  if (alarm) console.log(`P0 wspomniał o przycisku Alarm: ${alarm.mentionedAlarm ? 'tak' : 'NIE'}`)

  for (const r of results) {
    const want = expectedClickup(r.scenario.expect)
    if (r.priority !== want || r.awaria !== expectedAwaria(r.scenario.expect) || !r.askedBeforeCreating) {
      console.log(`\n--- ZAPIS ROZMOWY: ${r.scenario.id} (${r.scenario.note ?? ''})`)
      for (const line of r.transcript) console.log(line)
    }
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
