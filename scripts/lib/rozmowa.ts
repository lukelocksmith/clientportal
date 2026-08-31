/**
 * Wspólny silnik pomiarów asystenta zgłaszającego zadania.
 *
 * PO CO OSOBNY PLIK: pomiarów jest już trzy (priorytety, czy zadanie powstaje,
 * granice) i każdy potrzebuje tej samej rzeczy — rozmowy dwóch egzemplarzy
 * modelu, z podstawionym narzędziem `createTask`. Trzecia kopia tej pętli
 * rozjechałaby się z pozostałymi przy pierwszej zmianie, a wtedy dwa pomiary
 * mierzyłyby co innego, nie wiedząc o tym.
 *
 * Narzędzie jest ZAWSZE podstawione: żaden pomiar nie ma prawa niczego wysłać
 * do ClickUpa klienta.
 */
import { generateText, tool, stepCountIs, type ModelMessage } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import {
  buildNewTaskPrompt,
  taskInputSchema,
  CREATE_TASK_TOOL_DESCRIPTION,
} from '../../src/lib/taskPrompt'

const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
export const model = google('gemini-2.5-flash')

/** Argumenty, z jakimi model wywołał narzędzie. `null` = nie wywołał wcale. */
export type UtworzoneZadanie = {
  name: string
  description: string
  priority: number | null
  tags: string[]
  listId: string | null
} | null

export type PrzebiegRozmowy = {
  /** Czym skończyło się wywołanie narzędzia. */
  zadanie: UtworzoneZadanie
  /** Cała rozmowa, linia na wypowiedź, z prefiksem KLIENT / ASIA. */
  transcript: string[]
  /** Wszystko, co powiedział asystent, zlepione w jeden tekst do sprawdzeń. */
  tekstAsystenta: string
  tury: number
  error?: string
}

export type ScenariuszRozmowy = {
  id: string
  /** Pierwsza wiadomość klienta, tak jak wpisałby ją w portalu. */
  opening: string
  /** Sytuacja i sposób odpowiadania, językiem klienta. Prompt udawanego klienta. */
  situation: string
  /** Co ten scenariusz sprawdza. Drukowane przy porażce. */
  note: string
  /** Nazwa projektu w promptcie. Domyślnie „testowy". */
  portalName?: string
}

const KLIENT_SYSTEM = (s: ScenariuszRozmowy) => `Jesteś klientem agencji, który zgłasza sprawę przez czat w portalu.

Twoja sytuacja:
${s.situation}

Zasady:
- Odpowiadasz po polsku, potocznie, tak jak opisano wyżej.
- NIE używasz oznaczeń P0, P1, P2, P3 z własnej inicjatywy, chyba że sytuacja mówi inaczej.
- Nie wymyślasz faktów poza opisem sytuacji.
- Nie kończysz rozmowy sam, nie dziękujesz na zapas.`

/**
 * Przeprowadza jedną rozmowę do końca: albo do utworzenia zadania, albo do
 * wyczerpania cierpliwości klienta (`maxTur`).
 *
 * `maxTur` domyślnie SZEŚĆ, bo tyle trwała rozmowa z 30.08, po której Łukasz
 * poszedł sprawdzić tablicę i nic na niej nie znalazł. To zaobserwowana
 * cierpliwość, nie liczba z sufitu.
 */
export async function przeprowadzRozmowe(
  s: ScenariuszRozmowy,
  maxTur = 6
): Promise<PrzebiegRozmowy> {
  let utworzone: UtworzoneZadanie = null

  const createTaskTool = tool({
    description: CREATE_TASK_TOOL_DESCRIPTION,
    inputSchema: taskInputSchema,
    execute: async ({ name, description, priority, tags, listId }) => {
      utworzone = {
        name,
        description,
        priority: priority ?? null,
        tags: tags ?? [],
        listId: listId ?? null,
      }
      return { success: true, taskId: 'TEST', taskName: name, message: 'Zadanie dodane.' }
    },
  })

  const system = buildNewTaskPrompt({
    portalName: s.portalName ?? 'testowy',
    today: new Date().toLocaleDateString('pl-PL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  })

  const messages: ModelMessage[] = [{ role: 'user', content: s.opening }]
  const transcript: string[] = [`KLIENT: ${s.opening}`]
  const wypowiedzi: string[] = []
  let tury = 0

  try {
    for (let i = 0; i < maxTur && !utworzone; i++) {
      tury++
      const asia = await generateText({
        model,
        system,
        messages,
        tools: { createTask: createTaskTool },
        stopWhen: stepCountIs(6),
      })

      const tekst = asia.text.trim()
      if (tekst) {
        transcript.push(`ASIA: ${tekst}`)
        wypowiedzi.push(tekst)
      }
      messages.push(...asia.response.messages)
      if (utworzone) break
      if (!tekst) break

      const klient = await generateText({
        model,
        system: KLIENT_SYSTEM(s),
        messages: [{ role: 'user', content: tekst }],
      })
      const odpowiedz = klient.text.trim()
      transcript.push(`KLIENT: ${odpowiedz}`)
      messages.push({ role: 'user', content: odpowiedz })
    }
  } catch (e) {
    return {
      zadanie: utworzone,
      transcript,
      tekstAsystenta: wypowiedzi.join('\n'),
      tury,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  return {
    zadanie: utworzone,
    transcript,
    tekstAsystenta: wypowiedzi.join('\n'),
    tury,
  }
}

/** Wypisuje tabelę wyników i zwraca kod wyjścia. */
export function raport(
  naglowek: string,
  wiersze: Array<{ id: string; ok: boolean; opis: string; uwaga?: string; transcript: string[]; note: string }>
): number {
  console.log(`\n=== ${naglowek} ===`)
  const szer = Math.max(...wiersze.map(w => w.id.length), 10)
  for (const w of wiersze) {
    console.log(w.id.padEnd(szer + 2), (w.ok ? 'OK' : 'ŹLE').padEnd(5), w.opis, w.uwaga ? `· ${w.uwaga}` : '')
  }
  const ok = wiersze.filter(w => w.ok).length
  console.log(`\n${ok}/${wiersze.length} przebiegów w porządku`)

  for (const w of wiersze) {
    if (w.ok) continue
    console.log(`\n--- ZAPIS ROZMOWY: ${w.id} (${w.note})`)
    for (const linia of w.transcript) console.log(linia)
  }
  return ok === wiersze.length ? 0 : 1
}
