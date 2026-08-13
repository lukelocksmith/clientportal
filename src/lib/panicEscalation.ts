/**
 * Eskalacja alarmu: co zrobić, gdy klient wcisnął czerwony przycisk i przez
 * dwadzieścia pięć minut nikt tego nie przejął.
 *
 * Sam mechanizm zegara siedzi w `api/cron/panic-escalation`. Tutaj jest
 * WYŁĄCZNIE decyzja, bez wejścia w bazę i bez wyjścia na świat, żeby dało się
 * ją sprawdzić testem w milisekundach zamiast czekać pół godziny z prawdziwym
 * alarmem.
 */
import type { ClickUpAssignee, ClickUpTask } from './types'
import { toGsmSafe } from './sms'

/**
 * Po ilu minutach od wciśnięcia alarmu idzie kolejne powiadomienie.
 * Dwa kroki, potem cisza: trzeci SMS o tej samej sprawie przestaje być
 * sygnałem, a zaczyna być szumem, który się wycisza.
 */
export const ESCALATION_STEPS_MINUTES = [25, 50] as const

/**
 * Statusy, które znaczą „nikt tego jeszcze nie ruszył". Zadanie alarmowe
 * powstaje w „do zrobienia", więc dopóki tam siedzi, sprawa czeka.
 * Lista musi zgadzać się ze statusami przestrzeni ClickUp (patrz
 * STATUS_COLUMNS w utils.ts).
 */
export const UNSTARTED_STATUSES = ['backlog', 'do zrobienia'] as const

/**
 * Czy ktoś faktycznie przejął sprawę.
 *
 * Dwa warunki naraz, zgodnie z decyzją z 2026-08-13: w zadaniu jest przypisany
 * ktoś INNY niż osoba dyżurna (obok niej albo zamiast niej) ORAZ zadanie
 * ruszyło ze statusu początkowego. Samo przypisanie nie wystarcza, bo
 * przypisać można się odruchowo i wrócić do swojej roboty.
 *
 * To JEDYNY sygnał reakcji, jaki mamy. Link „Zajmuję się tym" z maila został
 * usunięty 2026-08-13: klikał go kto bądź, a trasa zapisywała jako
 * podejmującego „telefon" albo „komputer" z user-agenta, więc deklaracja nie
 * mówiła nic o tym, kto naprawdę wziął sprawę.
 */
export function isTaskHandled(input: {
  assignees: Pick<ClickUpAssignee, 'id'>[] | null | undefined
  status: string | null | undefined
  /** ClickUpowe id osoby przypisywanej automatycznie (dziś Paulina). */
  dutyAssigneeId: number | null
}): boolean {
  const ktosInny = (input.assignees ?? []).some(a => a.id !== input.dutyAssigneeId)
  if (!ktosInny) return false

  const status = (input.status ?? '').trim().toLowerCase()
  if (!status) return false
  return !UNSTARTED_STATUSES.some(s => s === status)
}

/**
 * Czy dla tego alarmu wypada właśnie kolejne powiadomienie.
 *
 * Liczy się LICZNIK wysłanych eskalacji, nie czas ostatniej wysyłki: cron jest
 * wołany z zewnątrz i może przyjść dwa razy pod rząd (ponowienie, zdublowany
 * wpis w crontabie). Licznik w bazie sprawia, że drugi przebieg w tej samej
 * minucie nie wyśle niczego drugi raz.
 */
export function isEscalationDue(input: {
  createdAt: Date
  escalationCount: number
  now: Date
}): boolean {
  const krok = ESCALATION_STEPS_MINUTES[input.escalationCount]
  if (krok === undefined) return false
  return input.now.getTime() - input.createdAt.getTime() >= krok * 60_000
}

/** Ile minut minęło od wciśnięcia alarmu, zaokrąglone w dół. */
export function minutesSince(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 60_000))
}

/** Adres zadania w ClickUpie. Zadanie mogło nie powstać, wtedy null. */
export function clickupTaskUrl(taskId: string | null | undefined): string | null {
  return taskId ? `https://app.clickup.com/t/${taskId}` : null
}

/**
 * Treść ponownego SMS-a.
 *
 * Link do zadania jest OBOWIĄZKOWY (decyzja Łukasza z 2026-08-13), więc to on
 * ma pierwszeństwo w budżecie 160 znaków, a treść zgłoszenia jest ucinana pod
 * niego. Adres ClickUpa to około 35 znaków i mieści się w jednym segmencie
 * GSM-7, w przeciwieństwie do linku potwierdzającego z maila, który ma w sobie
 * 64-znakowy token.
 */
export function buildEscalationSmsText(input: {
  portalName: string
  message: string
  minutes: number
  taskUrl: string | null
}): string {
  const MAX = 160
  const portal = toGsmSafe(input.portalName).slice(0, 40)
  const ogon = input.taskUrl
    ? ` | nikt nie przejal ${input.minutes} min | ${input.taskUrl}`
    : ` | nikt nie przejal ${input.minutes} min | zadanie w ClickUpie NIE powstalo`
  const prefix = `ALARM PONOWNIE ${portal}: `

  const budget = MAX - prefix.length - ogon.length
  const tresc = toGsmSafe(input.message)
  const message =
    budget <= 0
      ? ''
      : tresc.length <= budget
        ? tresc
        : `${tresc.slice(0, Math.max(budget - 3, 0)).trimEnd()}...`

  return `${prefix}${message}${ogon}`.slice(0, MAX)
}

/** Treść ponownego wpisu na Discordzie. Tu limitu długości nie ma. */
export function buildEscalationDiscordText(input: {
  portalName: string
  message: string
  who: string
  minutes: number
  taskUrl: string | null
}): string {
  const zadanie = input.taskUrl
    ? `**Zadanie:** ${input.taskUrl}`
    : '**Zadanie:** nie powstało w ClickUpie, sprawdź ręcznie'
  return (
    `🚨 **ALARM BEZ REAKCJI od ${input.minutes} minut — ${input.portalName}**\n\n` +
    `> ${input.message}\n\n` +
    `**Zgłasza:** ${input.who}\n` +
    `Poza osobą dyżurną nikt nie jest przypisany, a zadanie nie ruszyło ze statusu początkowego.\n\n` +
    zadanie
  )
}

/** Kandydaci do eskalacji, po odsianiu tych, którym jeszcze nie minął czas. */
export function selectDueAlerts<T extends { createdAt: Date; escalationCount: number }>(
  alerts: T[],
  now: Date
): T[] {
  return alerts.filter(a =>
    isEscalationDue({ createdAt: a.createdAt, escalationCount: a.escalationCount, now })
  )
}

/** Skrót używany przez trasę cronu przy zadaniu pobranym z ClickUpa. */
export function isHandledTask(task: ClickUpTask, dutyAssigneeId: number | null): boolean {
  return isTaskHandled({
    assignees: task.assignees,
    status: task.status?.status,
    dutyAssigneeId,
  })
}
