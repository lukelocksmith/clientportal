import { render } from '@react-email/render'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { portals, portalUsers } from './db/schema'
import { resolveBranding } from './branding'
import { sendMail } from './mailer'
import { chooseRecipients } from './notifications'
import { commentAlreadyNotified, createNotifications } from './notificationStore'
import {
  channelEnabled,
  notificationsOff,
  parseNotificationConfig,
  type NotifyEvent,
} from './notifyConfig'
import { bellPayload, mailText } from './notifyText'
import {
  actorOfCommentEvent,
  actorOfRecentStatusChange,
  actorOfTaskCreated,
  reporterUserId,
} from './portalEvents'
import { EmailShell } from '@/emails/EmailShell'

/**
 * Producent powiadomień: jedno zdarzenie na wejściu, wiersze w dzwonku i maile
 * na wyjściu.
 *
 * Zbudowany 2026-08-24. Wcześniej cała maszyneria istniała (tabela, dzwonek,
 * wybór odbiorców, wysyłka poczty) i była przetestowana, ale NIKT JEJ NIE
 * WOŁAŁ: `createNotifications` miało wywołania wyłącznie z testów, więc dzwonek
 * w produkcji był zawsze pusty. To jest ten brakujący spust.
 *
 * Co decyduje o czym:
 * - **czy wysyłamy** — macierz projektu (lib/notifyConfig.ts), ustawiana przez
 *   admina. Brak konfiguracji znaczy ciszę, więc funkcja jest domyślnie
 *   wyłączona we wszystkich projektach.
 * - **do kogo** — `chooseRecipients` (lib/notifications.ts): dzwonek dla
 *   wszystkich aktywnych, mail dla autora zgłoszenia.
 * - **co pisze** — lib/notifyText.ts.
 *
 * NIGDY NIE RZUCA WYJĄTKIEM. Wołający to webhook ClickUpa: błąd zwrócony z tej
 * trasy sprawia, że ClickUp ponawia zdarzenie, a po serii nieudanych prób
 * wyłącza subskrypcję. Cisza w powiadomieniach jest zła, martwy webhook jest
 * gorszy, bo zabiera też indeksowanie Historii.
 */

export type ProduceInput = {
  portalId: string
  event: NotifyEvent
  taskId: string
  taskName: string
  /** Autor komentarza po stronie ClickUpa, do treści dzwonka i maila. */
  author?: string | null
  excerpt?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  /** Identyfikator komentarza z ClickUpa: deterministyczne tłumienie własnej akcji. */
  clickupCommentId?: string | null
}

export type ProduceResult = {
  /** Ile wierszy powiadomień powstało. */
  bell: number
  /** Do ilu osób poszedł mail. */
  mailed: number
  /** Dlaczego nic nie powstało, gdy nic nie powstało. */
  reason?: 'no-portal' | 'off' | 'channel-off' | 'no-audience' | 'duplicate' | 'error'
}

/**
 * Okno tłumienia zmiany statusu zrobionej z portalu.
 *
 * Dwie minuty, bo tyle wystarcza na drogę żądanie → ClickUp → webhook przy
 * zwykłym opóźnieniu, a jednocześnie jest krótsze niż realny czas między
 * zmianą klienta i niezależną zmianą zespołu.
 */
const STATUS_SUPPRESSION_MS = 2 * 60 * 1000

export async function produceNotifications(input: ProduceInput): Promise<ProduceResult> {
  try {
    return await produce(input)
  } catch (e) {
    // Log do kontenera, nie wyjątek do webhooka. Patrz komentarz nagłówkowy.
    console.error(`[notify] zdarzenie ${input.event} dla zadania ${input.taskId} nie powiodło się:`, e)
    return { bell: 0, mailed: 0, reason: 'error' }
  }
}

async function produce(input: ProduceInput): Promise<ProduceResult> {
  const [portal] = await db
    .select({
      slug: portals.slug,
      name: portals.name,
      logoUrl: portals.logoUrl,
      brandColor: portals.brandColor,
      notificationConfig: portals.notificationConfig,
    })
    .from(portals)
    .where(eq(portals.id, input.portalId))
    .limit(1)

  if (!portal) return { bell: 0, mailed: 0, reason: 'no-portal' }

  const config = parseNotificationConfig(portal.notificationConfig)
  if (notificationsOff(config)) return { bell: 0, mailed: 0, reason: 'off' }

  const bellOn = channelEnabled(config, input.event, 'bell')
  const mailOn = channelEnabled(config, input.event, 'mail')
  if (!bellOn && !mailOn) return { bell: 0, mailed: 0, reason: 'channel-off' }

  /**
   * To samo zdarzenie drugi raz. ClickUp dostarcza „co najmniej raz", a webhook
   * przychodzi także przy EDYCJI komentarza, kiedy najnowszy w wątku bywa ten
   * sam. Sprawdzamy PRZED policzeniem odbiorców, bo to najtańsze zapytanie.
   */
  if (input.event === 'comment' && input.clickupCommentId) {
    if (await commentAlreadyNotified(input.portalId, input.clickupCommentId)) {
      return { bell: 0, mailed: 0, reason: 'duplicate' }
    }
  }

  const [actorUserId, ownerUserId, users] = await Promise.all([
    detectActor(input),
    reporterUserId(input.portalId, input.taskId),
    db
      .select({
        id: portalUsers.id,
        email: portalUsers.email,
        isActive: portalUsers.isActive,
        notifyImportant: portalUsers.notifyImportant,
        notifyBoard: portalUsers.notifyBoard,
      })
      .from(portalUsers)
      .where(eq(portalUsers.portalId, input.portalId)),
  ])

  const recipients = chooseRecipients({
    users,
    kind: input.event,
    actorUserId,
    ownerUserId,
  })
  if (recipients.length === 0) return { bell: 0, mailed: 0, reason: 'no-audience' }

  /**
   * Kto dostaje maila: ci, którym `chooseRecipients` przypisał kanał poczty,
   * czyli autor zgłoszenia (albo wszyscy, gdy zadanie założyła agencja).
   *
   * TRYB `daily` traktujemy tu jak `instant`, bo digestu jeszcze nie ma. Gdyby
   * `daily` znaczyło „nie wysyłaj teraz", ruch na tablicy nie powiadamiałby
   * NIGDY, a admin, który zaznaczył mail w macierzy, ma prawo oczekiwać maila.
   * `never` u użytkownika nadal wyłącza pocztę: to jego decyzja, nie domyślna.
   */
  const mailTargets = mailOn ? recipients.filter(r => r.mail !== null) : []

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://portal.important.is'
  const taskUrl = `${appUrl}/${portal.slug}?task=${encodeURIComponent(input.taskId)}`
  const text = mailText({
    event: input.event,
    taskName: input.taskName,
    portalName: portal.name,
    taskUrl,
    author: input.author,
    excerpt: input.excerpt,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
  })

  const emailById = new Map(users.map(u => [u.id, u.email]))
  const mailedIds = new Set(mailTargets.map(r => r.userId))

  /**
   * Wiersze powstają ZAWSZE, także przy wyłączonym dzwonku.
   *
   * Wiersz jest zapisem „o tym już powiadomiliśmy" i to po nim rozpoznajemy
   * powtórkę zdarzenia z ClickUpa. Gdy dzwonek jest wyłączony, wiersz dostaje
   * `bellVisible: false` i nie pokazuje się klientowi, ale brama powtórek nadal
   * ma po czym poznać, że mail już poszedł.
   */
  let bell = 0
  {
    const rows = await createNotifications(
      recipients.map(r => ({
        portalId: input.portalId,
        userId: r.userId,
        kind: input.event,
        clickupTaskId: input.taskId,
        taskName: input.taskName,
        payload: {
          ...bellPayload({
            event: input.event,
            taskName: input.taskName,
            portalName: portal.name,
            taskUrl,
            author: input.author,
            excerpt: input.excerpt,
            fromStatus: input.fromStatus,
            toStatus: input.toStatus,
          }),
          // Ślad dla bramy powtórek wyżej. Dzwonek tego pola nie renderuje.
          ...(input.clickupCommentId ? { commentId: input.clickupCommentId } : {}),
        },
        bellVisible: bellOn,
        // Stempel od razu, gdy mail idzie teraz: przyszły digest ma go pominąć.
        emailSentAt: mailedIds.has(r.userId) ? new Date() : null,
      }))
    )
    // Liczymy to, co ZADZWONI. Wiersze niewidoczne nie są powiadomieniem dla
    // klienta, tylko zapisem dla nas.
    bell = bellOn ? rows.length : 0
  }

  let mailed = 0
  if (mailTargets.length > 0) {
    const branding = resolveBranding({ logoUrl: portal.logoUrl, brandColor: portal.brandColor })
    const html = await render(
      EmailShell({
        portalName: portal.name,
        preview: text.preview,
        greeting: text.greeting,
        paragraphs: text.paragraphs,
        buttonLabel: text.buttonLabel,
        buttonUrl: text.buttonUrl,
        notes: text.notes,
        brandColor: branding.brandColor,
        brandForeground: branding.brandForeground,
      })
    )

    // Równolegle i `allSettled`: jeden odbiorca z zepsutym adresem nie może
    // zabrać powiadomienia pozostałym.
    const wyniki = await Promise.allSettled(
      mailTargets.map(async r => {
        const to = emailById.get(r.userId)
        if (!to) return false
        const res = await sendMail({
          to,
          subject: text.subject,
          html,
          text: [...text.paragraphs, text.buttonUrl].join('\n\n'),
          kind: 'notification',
          portalId: input.portalId,
        })
        return res.sent
      })
    )
    mailed = wyniki.filter(w => w.status === 'fulfilled' && w.value === true).length
  }

  return { bell, mailed }
}

/**
 * Kto z portalu wywołał to zdarzenie, jeśli ktokolwiek.
 *
 * Portal i zespół piszą do ClickUpa jednym kontem serwisowym, więc webhook
 * wraca nierozróżnialny. Bez tego klient dostawałby powiadomienie o tym, co sam
 * przed chwilą zrobił.
 */
async function detectActor(input: ProduceInput): Promise<string | null> {
  if (input.event === 'comment') {
    return input.clickupCommentId
      ? actorOfCommentEvent(input.portalId, input.clickupCommentId)
      : null
  }
  if (input.event === 'created') {
    return actorOfTaskCreated(input.portalId, input.taskId)
  }
  // status i closed
  if (!input.toStatus) return null
  return actorOfRecentStatusChange({
    portalId: input.portalId,
    clickupTaskId: input.taskId,
    toStatus: input.toStatus,
    withinMs: STATUS_SUPPRESSION_MS,
  })
}
