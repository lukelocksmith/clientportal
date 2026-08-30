/**
 * CZY ZADANIE W OGÓLE POWSTAJE. Podstawowa funkcja czatu, mierzona wprost.
 *
 *   node --env-file=.env.local --import tsx scripts/czy-zadanie-powstaje.ts [id-scenariusza] [powtorzenia]
 *
 * PO CO, skoro jest już check-priority.ts: tamten pyta „JAKI priorytet dostało
 * zadanie" i zakłada, że zadanie powstaje. 30.08 okazało się, że to założenie
 * bywa fałszywe: Łukasz zgłosił sprawę przez asystenta w portalu testowym,
 * odbyło się sześć wymian zdań i nie powstało NIC. Tamten zestaw tego nie
 * łapie, bo udawany klient jest w nim wzorowo współpracujący: odpowiada
 * konkretnie i zawsze potwierdza poziom.
 *
 * Tu klient jest TRUDNY w sposób, w jaki trudni są prawdziwi ludzie: pisze
 * półsłówkami, odpowiada „nie wiem", potwierdza jednym „ok", nie wie, jak
 * nazwać problem. Sprawdzamy JEDNO: czy w rozsądnej liczbie tur powstaje
 * zadanie, a jeśli nie — czy model przypadkiem nie napisał, że powstało.
 *
 * TA DRUGA RZECZ JEST GROŹNIEJSZA od braku zadania. Klient, który usłyszał
 * „zgłoszenie zapisane", zamyka okno i czeka. Nikt nie czeka na coś, o czym
 * wie, że nie zostało zgłoszone.
 *
 * Narzędzie `createTask` jest PODSTAWIONE: nic nie leci do ClickUpa.
 * Kod wyjścia: 0 gdy każdy scenariusz kończy się zadaniem, 1 gdy nie.
 */
import { generateText, tool, stepCountIs, type ModelMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import {
  buildNewTaskPrompt,
  taskInputSchema,
  CREATE_TASK_TOOL_DESCRIPTION,
} from '../src/lib/taskPrompt'
import { claimsTaskCreated } from '../src/lib/aiTranscript'

const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
const model = google('gemini-2.5-flash')

/**
 * Ile wymian zdań daje klient, zanim uzna, że nic z tego nie będzie.
 *
 * Sześć, bo tyle trwała rozmowa z 30.08, po której Łukasz poszedł sprawdzić
 * tablicę. To nie jest liczba wzięta z sufitu, tylko zaobserwowana cierpliwość.
 */
const MAX_TUR = 6

type Scenariusz = {
  id: string
  opening: string
  situation: string
  note: string
}

const SCENARIUSZE: Scenariusz[] = [
  {
    id: 'polslowka',
    opening: 'menu nie działa',
    situation:
      'Na stronie important.is przycisk w menu nie otwiera podstrony. Piszesz BARDZO krótko, po dwa, trzy słowa, bez wielkich liter i bez kropek. Nie rozwijasz odpowiedzi, nawet gdy asystentka prosi o szczegóły. Na pytanie o termin mówisz „obojętnie". Gdy asystentka proponuje poziom zgłoszenia, odpowiadasz samym „ok".',
    note: 'klient piszący półsłówkami — najczęstszy przypadek w portalu',
  },
  {
    id: 'nie-wiem',
    opening: 'coś się porobiło ze stroną',
    situation:
      'Strona wygląda inaczej niż wczoraj, ale nie umiesz powiedzieć co dokładnie. Na większość pytań odpowiadasz „nie wiem" albo „nie umiem powiedzieć". Adresu nie podajesz, bo nie wiesz, o który chodzi. Terminu nie masz. Jeśli asystentka zapyta o poziom, mówisz „wy wiecie lepiej".',
    note: 'klient, który nie umie opisać problemu — zadanie MA powstać mimo braków',
  },
  {
    id: 'jedno-slowo-tak',
    opening: 'trzeba poprawić formularz kontaktowy, nie przychodzą wiadomości',
    situation:
      'Formularz kontaktowy na important.is nie wysyła wiadomości. Odpowiadasz rzeczowo, ale bardzo krótko. Na KAŻDE pytanie potwierdzające odpowiadasz jednym słowem: „tak", „ok", „zgadza się". Nigdy nie piszesz zdania dłuższego niż trzy słowa.',
    note: 'potwierdzenie jednym słowem musi wystarczyć do założenia zadania',
  },
  {
    id: 'zmiana-tematu',
    opening: 'chcę zgłosić dwie rzeczy',
    situation:
      'Masz dwie sprawy: baner na stronie głównej ma zły tekst ORAZ zdjęcia produktów są za duże na telefonie. Zaczynasz od banera, ale po drugiej odpowiedzi asystentki przypominasz sobie o zdjęciach i piszesz o nich. Odpowiadasz krótko. Terminu nie masz.',
    note: 'dwie sprawy naraz nie mogą zawiesić zakładania',
  },
  {
    id: 'zniecierpliwiony',
    opening: 'przycisk zamów nie działa na telefonie',
    situation:
      'Na important.is przycisk zamówienia nie reaguje na telefonie. Po DRUGIM pytaniu asystentki tracisz cierpliwość i piszesz „no zgłoś to po prostu", „ile można pytać". Nie podajesz więcej szczegółów. Poziomu nie wybierasz.',
    note: 'klient, który nie chce odpowiadać na kolejne pytania',
  },
]

const KLIENT_SYSTEM = (s: Scenariusz) => `Jesteś klientem agencji, który zgłasza sprawę przez czat w portalu.

Twoja sytuacja:
${s.situation}

Zasady:
- Odpowiadasz po polsku, potocznie, tak jak opisano wyżej.
- NIE używasz oznaczeń P0, P1, P2, P3 z własnej inicjatywy.
- Nie wymyślasz faktów poza opisem sytuacji.
- Nie kończysz rozmowy sam, nie dziękujesz na zapas.`

type Wynik = {
  scenariusz: Scenariusz
  powstalo: boolean
  tury: number
  /** Model napisał, że zadanie jest, a narzędzia nie tknął. Najgorszy wynik. */
  klamstwo: boolean
  transcript: string[]
  error?: string
}

async function przebieg(s: Scenariusz): Promise<Wynik> {
  let utworzone: { name: string } | null = null

  const createTaskTool = tool({
    description: CREATE_TASK_TOOL_DESCRIPTION,
    inputSchema: taskInputSchema,
    execute: async ({ name }) => {
      utworzone = { name }
      return { success: true, taskId: 'TEST', taskName: name, message: 'Zadanie dodane.' }
    },
  })

  const system = buildNewTaskPrompt({
    portalName: 'testowy',
    today: new Date().toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
  })

  const messages: ModelMessage[] = [{ role: 'user', content: s.opening }]
  const transcript: string[] = [`KLIENT: ${s.opening}`]
  let tury = 0
  let ostatniTekst = ''

  try {
    for (let i = 0; i < MAX_TUR && !utworzone; i++) {
      tury++
      const asia = await generateText({
        model,
        system,
        messages,
        tools: { createTask: createTaskTool },
        stopWhen: stepCountIs(6),
      })

      ostatniTekst = asia.text.trim()
      if (ostatniTekst) transcript.push(`ASIA: ${ostatniTekst}`)
      messages.push(...asia.response.messages)
      if (utworzone) break
      if (!ostatniTekst) break

      const klient = await generateText({ model, system: KLIENT_SYSTEM(s), messages: [{ role: 'user', content: ostatniTekst }] })
      const odpowiedz = klient.text.trim()
      transcript.push(`KLIENT: ${odpowiedz}`)
      messages.push({ role: 'user', content: odpowiedz })
    }
  } catch (e) {
    return { scenariusz: s, powstalo: false, tury, klamstwo: false, transcript, error: e instanceof Error ? e.message : String(e) }
  }

  return {
    scenariusz: s,
    powstalo: utworzone !== null,
    tury,
    // Ta sama funkcja, która pilnuje tego na produkcji (lib/aiTranscript.ts),
    // żeby skrypt i portal nie rozjechały się w ocenie tego samego zdania.
    klamstwo: utworzone === null && claimsTaskCreated(ostatniTekst),
    transcript,
  }
}

async function main() {
  const only = process.argv[2]
  const powtorzenia = Number(process.argv[3] ?? 1)
  const lista = only && only !== 'all' ? SCENARIUSZE.filter(s => s.id === only) : SCENARIUSZE

  const wyniki: Wynik[] = []
  for (const s of lista) {
    for (let i = 0; i < powtorzenia; i++) {
      process.stdout.write(`... ${s.id}${powtorzenia > 1 ? ` (${i + 1}/${powtorzenia})` : ''}\n`)
      wyniki.push(await przebieg(s))
    }
  }

  console.log('\n=== CZY POWSTAŁO ZADANIE ===')
  console.log('scenariusz'.padEnd(18), 'zadanie'.padEnd(9), 'tur'.padEnd(4), 'uwaga')
  let ok = 0
  for (const w of wyniki) {
    if (w.powstalo) ok++
    console.log(
      w.scenariusz.id.padEnd(18),
      (w.powstalo ? 'TAK' : 'NIE').padEnd(9),
      String(w.tury).padEnd(4),
      w.klamstwo ? 'MODEL NAPISAŁ, ŻE ZGŁOSIŁ, A NIE ZGŁOSIŁ' : (w.error ?? '')
    )
  }
  console.log(`\n${ok}/${wyniki.length} rozmów skończyło się zadaniem (limit ${MAX_TUR} tur)`)

  for (const w of wyniki) {
    if (w.powstalo && !w.klamstwo) continue
    console.log(`\n--- ZAPIS ROZMOWY: ${w.scenariusz.id} (${w.scenariusz.note})`)
    for (const linia of w.transcript) console.log(linia)
  }

  process.exit(ok === wyniki.length ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
