/**
 * Czy droga zgłoszeń klienta jest przejezdna. Czysta reguła, bez bazy.
 *
 * PO CO (31.08). Cała ochrona zgłoszeń i alarmów stoi na dwóch cronach:
 * `pending-reports` dowozi zgłoszenia, `panic-escalation` przypomina o
 * alarmach bez reakcji. Oba alarmują na Discordzie, GDY SIĘ WYKONAJĄ
 * I NIE UDADZĄ. Cron, który przestał być wołany, nie alarmuje o niczym —
 * cisza wygląda wtedy identycznie jak spokój.
 *
 * Ten moduł liczy werdykt dla ZEWNĘTRZNEGO czujnika (UptimeRobot), bo tylko
 * coś spoza naszego serwera zauważy, że nasz serwer zamilkł. Czujnik szuka
 * w odpowiedzi słowa „OK".
 *
 * Zasada z rozmowy o monitoringu (25.08, Hetzner): odpytywanie bez sprawdzenia
 * WYNIKU i bez kanału alertu nie jest monitoringiem. Health check ma mierzyć
 * to, co może się zepsuć, a nie to, że proces żyje.
 */

/** Ile minut bez przebiegu znaczy „ten cron nie chodzi". */
export const CRON_LIMITS_MINUTES = {
  // Chodzi co 2 min. Kwadrans ciszy to już nie opóźnienie.
  'pending-reports': 15,
  // Chodzi co 5 min. Przy alarmie bez reakcji to jedyna rzecz, która pilnuje
  // drabinki przypomnień, więc granica jest wąska.
  'panic-escalation': 20,
  // Raz na dobę, 6:20. Doba i pół daje miejsce na jeden nieudany przebieg.
  'task-index': 36 * 60,
} as const

export type CronName = keyof typeof CRON_LIMITS_MINUTES

/** Ile minut zgłoszenie może czekać w kolejce, zanim to jest awaria. */
export const QUEUE_LIMIT_MINUTES = 20

export type HealthInput = {
  /** Ostatni przebieg każdego pilnowanego crona. `null` znaczy „nigdy". */
  lastRuns: Partial<Record<CronName, Date | null>>
  /** Ile zgłoszeń czeka w kolejce. */
  pending: number
  /** Wiek najstarszego czekającego zgłoszenia w minutach. `null`, gdy pusto. */
  oldestPendingMinutes: number | null
  now: Date
}

export type HealthVerdict = {
  ok: boolean
  /** Jedna linia dla czujnika. Zaczyna się od „OK" albo od „PROBLEM". */
  line: string
  problems: string[]
}

function minutesSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / 60_000)
}

export function reportingHealth(input: HealthInput): HealthVerdict {
  const problems: string[] = []

  for (const [name, limit] of Object.entries(CRON_LIMITS_MINUTES) as Array<[CronName, number]>) {
    const last = input.lastRuns[name] ?? null
    if (!last) {
      problems.push(`cron ${name}: ani jednego przebiegu`)
      continue
    }
    const wiek = minutesSince(last, input.now)
    if (wiek > limit) problems.push(`cron ${name}: ostatni przebieg ${wiek} min temu (limit ${limit})`)
  }

  if (input.oldestPendingMinutes !== null && input.oldestPendingMinutes > QUEUE_LIMIT_MINUTES) {
    problems.push(
      `kolejka zgłoszeń: ${input.pending} czeka, najstarsze ${input.oldestPendingMinutes} min (limit ${QUEUE_LIMIT_MINUTES})`
    )
  }

  return problems.length === 0
    ? { ok: true, line: `OK · kolejka ${input.pending}`, problems }
    : { ok: false, line: `PROBLEM · ${problems.join(' · ')}`, problems }
}
