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
 * Po ilu minutach od zgłoszenia idzie kolejne przypomnienie.
 *
 * Drabina zagęszcza się przy 60 minucie, potem robi dwie godzinne przerwy, a
 * na koniec znów przyspiesza przed czwartą godziną, bo to jest umówiony czas
 * na reakcję. Po ostatnim kroku portal milknie: jeśli przez cztery godziny
 * nikt sprawy nie tknął, kolejny SMS niczego nie zmieni, a zacznie być
 * ignorowany jak alarm samochodowy.
 */
export const ESCALATION_STEPS_DAY = [25, 50, 60, 65, 120, 180, 210, 240] as const

/**
 * To samo w nocy, z zachowaniem minimum PÓŁ GODZINY przerwy między
 * przypomnieniami. Pierwsze idzie tak samo szybko, bo awaria o trzeciej w nocy
 * jest awarią, ale seria co pięć minut budziłaby trzy osoby bez pożytku.
 */
export const ESCALATION_STEPS_NIGHT = [25, 55, 120, 180, 210, 240] as const

/** Zachowane dla zgodności: dzienna drabina jest tą domyślną. */
export const ESCALATION_STEPS_MINUTES = ESCALATION_STEPS_DAY

/** Noc zaczyna się o 22:00 i kończy o 7:00 czasu warszawskiego. */
export const NIGHT_FROM_HOUR = 22
export const NIGHT_TO_HOUR = 7

/**
 * Czy w danej chwili jest noc w Warszawie.
 *
 * Godzinę liczymy w strefie `Europe/Warsaw`, a nie z lokalnego zegara serwera,
 * bo kontener chodzi w UTC i o 23:30 czasu polskiego widziałby 21:30, czyli
 * jeszcze dzień. Latem różnica wynosi dwie godziny, zimą jedną, więc własne
 * przeliczanie byłoby błędem czekającym na zmianę czasu.
 */
export function isNightInWarsaw(at: Date): boolean {
  const godzina = Number(
    new Intl.DateTimeFormat('pl-PL', {
      timeZone: 'Europe/Warsaw',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(at)
  )
  return godzina >= NIGHT_FROM_HOUR || godzina < NIGHT_TO_HOUR
}

/**
 * Czy wypada kolejne przypomnienie.
 *
 * Argumenty są POZYCYJNE i są liczbami, świadomie. Wcześniejsza wersja
 * przyjmowała obiekt i minifikator produkcyjny, wtapiając ją w trasę,
 * produkował odwołanie do nieistniejącej zmiennej (`ReferenceError: now is not
 * defined`, 14.08.2026). Prosty podpis nie daje mu okazji.
 */
export function escalationDueAtIndex(
  createdAtMs: number,
  index: number,
  nowMs: number,
  atNight: boolean
): boolean {
  const drabina = atNight ? ESCALATION_STEPS_NIGHT : ESCALATION_STEPS_DAY
  if (index < 0 || index >= drabina.length) return false
  return nowMs - createdAtMs >= drabina[index] * 60_000
}

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

/**
 * Kto przejął sprawę. Imię bierzemy z ClickUpa, a nie z naszej listy zespołu,
 * bo sprawę może wziąć ktoś spoza TEAM_MEMBERS i wtedy „ktoś" byłoby gorsze
 * od prawdziwego nazwiska. Pomijamy osobę dyżurną, bo ona jest przypisana
 * automatycznie przy każdym alarmie i nie niesie informacji.
 */
export function whoTookOver(
  assignees: Array<{ id: number; username?: string }> | null | undefined,
  dutyAssigneeId: number | null
): string {
  const inni = (assignees ?? []).filter(a => a.id !== dutyAssigneeId)
  const imiona = inni.map(a => (a.username ?? '').trim()).filter(n => n.length > 0)
  if (imiona.length === 0) return 'ktoś z zespołu'
  return imiona.join(', ')
}

/** SMS o przejęciu sprawy. Krótszy niż alarmowy, bo to dobra wiadomość. */
export function buildHandoverSmsText(input: {
  portalName: string
  who: string
  minutes: number
  taskUrl: string | null
}): string {
  const MAX = 160
  const portal = toGsmSafe(input.portalName).slice(0, 30)
  const kto = toGsmSafe(input.who).slice(0, 40)
  const ogon = input.taskUrl ? ` | ${input.taskUrl}` : ''
  return `PRZEJETE ${portal}: sprawe wzial ${kto}, po ${input.minutes} min${ogon}`.slice(0, MAX)
}

/** Wpis na Discordzie o przejęciu sprawy. */
export function buildHandoverDiscordText(input: {
  portalName: string
  who: string
  message: string
  minutes: number
  status: string
  taskUrl: string | null
}): string {
  return (
    `✅ **Alarm przejęty — ${input.portalName}**\n\n` +
    `> ${input.message}\n\n` +
    `**Zajmuje się:** ${input.who}\n` +
    `**Status zadania:** ${input.status}\n` +
    `**Czas od zgłoszenia:** ${input.minutes} min\n\n` +
    (input.taskUrl ? `**Zadanie:** ${input.taskUrl}` : '')
  )
}
