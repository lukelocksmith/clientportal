import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gte, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { panicAlerts, portals } from '@/lib/db/schema'
import { getTask } from '@/lib/clickup'
import { verifyToken } from '@/lib/apiAuth'
import { recordCronRun } from '@/lib/cronRuns'
import { dutyAssigneeId } from '@/lib/panicDuty'
import {
  ESCALATION_STEPS_MINUTES,
  buildEscalationDiscordText,
  buildEscalationSmsText,
  buildHandoverDiscordText,
  buildHandoverSmsText,
  isHandledTask,
  whoTookOver,
} from '@/lib/panicEscalation'
import { panicEmailHtml, sendPanicDiscord, sendPanicEmails, sendPanicSms } from '@/lib/panicNotify'
import { reporterLabel } from '@/lib/reporter'

export const dynamic = 'force-dynamic'

/**
 * Ile wstecz w ogóle patrzymy. Alarm sprzed doby albo został obsłużony, albo
 * ma dawno swoje życie poza portalem; budzenie zespołu po takim czasie byłoby
 * hałasem, a nie sygnałem. Zawężenie chroni też przed sytuacją, w której
 * wyłączony na tydzień cron po włączeniu wysyła serię zaległych SMS-ów.
 */
const LOOKBACK_HOURS = 24

/**
 * Eskalacja alarmów, których nikt nie przejął.
 *
 * Wołane z crontaba co 5 minut. Auth jak w pozostałych cronach:
 * `Authorization: Bearer <CRON_SECRET>` albo `?token=<CRON_SECRET>`.
 *
 * Reguła (ustalenie z 2026-08-13): sprawa jest przejęta, gdy w zadaniu jest
 * przypisany ktoś inny niż osoba dyżurna ORAZ zadanie ruszyło ze statusu
 * początkowego. Wszystko inne to brak reakcji, więc po 25 i po 50 minutach
 * idzie ponowne powiadomienie: SMS, Discord i mail, każde z linkiem do zadania.
 *
 * Ważne dla dokładności: cron co 5 minut znaczy, że eskalacja wypada między 25
 * a 30 minutą, a nie co do sekundy. To świadomy kompromis między precyzją a
 * liczbą pukań w aplikację.
 */
async function handle(request: NextRequest) {
  if (!verifyToken(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date()
  const now = startedAt
  const duty = dutyAssigneeId()

  try {
    const kandydaci = await db
      .select({
        id: panicAlerts.id,
        portalId: panicAlerts.portalId,
        portalName: portals.name,
        message: panicAlerts.message,
        userName: panicAlerts.userName,
        userEmail: panicAlerts.userEmail,
        clickupTaskId: panicAlerts.clickupTaskId,
        escalationCount: panicAlerts.escalationCount,
        createdAt: panicAlerts.createdAt,
        handledAt: panicAlerts.handledAt,
      })
      .from(panicAlerts)
      .innerJoin(portals, eq(portals.id, panicAlerts.portalId))
      .where(
        and(
          // Sprawy przejęte wypadają z kolejki na dobre: powiadomienie o
          // przejęciu poszło raz, więcej nie ma o czym przypominać.
          isNull(panicAlerts.handledAt),
          gte(panicAlerts.createdAt, new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000))
        )
      )
      // ŚWIADOMIE bez warunku na licznik eskalacji. Alarm, przy którym oba
      // przypomnienia już poszły, nadal ma prawo doczekać się informacji „ktoś
      // to wziął": to właśnie wtedy jest ona najbardziej potrzebna, bo sprawa
      // wisiała ponad godzinę. Licznik decyduje wyłącznie o KOLEJNYM
      // przypomnieniu, nie o tym, czy w ogóle patrzymy na zadanie.

    /**
     * Wybór alarmów do eskalacji liczony TUTAJ, bez wołania `selectDueAlerts`.
     *
     * Powód jest konkretny i potwierdzony skompilowanym kodem z produkcji
     * (14.08.2026): minifikator wtapiał tę funkcję razem z zagnieżdżonym
     * `isEscalationDue({ ..., now })` i w SKRÓCONYM ZAPISIE właściwości
     * zostawiał starą nazwę zmiennej, którą wcześniej sam przemianował. Każdy
     * przebieg z realnym alarmem kończył się wtedy `ReferenceError: now is not
     * defined`. Testy tego nie widzą, bo nie są minifikowane.
     *
     * Stąd zapis bez skrótów i bez obiektów pośrednich.
     */
    const czyWypadaEskalacja = (alert: { escalationCount: number; createdAt: Date }) => {
      const krokMinuty = ESCALATION_STEPS_MINUTES[alert.escalationCount]
      if (krokMinuty === undefined) return false
      return now.getTime() - alert.createdAt.getTime() >= krokMinuty * 60_000
    }

    /**
     * Sprawdzamy zadanie, gdy wypada eskalacja ALBO gdy alarm ma zadanie, które
     * ktoś mógł w międzyczasie przejąć. Drugi warunek zaczyna działać dopiero
     * po pierwszym progu, żeby nie odpytywać ClickUpa o sprawę zgłoszoną minutę
     * temu, którą i tak nikt nie zdążył ruszyć.
     */
    const pierwszyProg = ESCALATION_STEPS_MINUTES[0] * 60_000
    const doSprawdzenia = kandydaci.filter(
      alert =>
        czyWypadaEskalacja(alert) ||
        (alert.clickupTaskId !== null && now.getTime() - alert.createdAt.getTime() >= pierwszyProg)
    )

    const wyniki: Array<{ alertId: string; escalated: boolean; reason: string }> = []

    for (const alert of doSprawdzenia) {
      // Brak zadania to NIE jest powód do ciszy. Zakładanie zadania jest
      // best-effort, więc pusty identyfikator znaczy „ClickUp nie odpowiedział",
      // a nie „ktoś się tym zajął".
      let przejete = false
      let powod = 'brak zadania w ClickUpie'
      let ktoPrzejal = ''
      let statusZadania = ''

      if (alert.clickupTaskId) {
        try {
          const task = await getTask(alert.clickupTaskId)
          przejete = isHandledTask(task, duty)
          statusZadania = task.status?.status ?? 'brak'
          ktoPrzejal = whoTookOver(task.assignees, duty)
          powod = przejete
            ? `przejął: ${ktoPrzejal}`
            : `przypisani: ${task.assignees?.length ?? 0}, status: ${statusZadania}`
        } catch (e) {
          // Nie wiemy, czy ktoś przejął sprawę. Przy alarmie niewiedza ma
          // budzić, nie uciszać, więc eskalujemy i zapisujemy powód.
          powod = `ClickUp nie odpowiedział: ${e instanceof Error ? e.message : String(e)}`
        }
      }

      const minutyOdZgloszenia = Math.max(
        0,
        Math.floor((now.getTime() - alert.createdAt.getTime()) / 60_000)
      )
      const adresZadania = alert.clickupTaskId
        ? `https://app.clickup.com/t/${alert.clickupTaskId}`
        : null

      if (przejete) {
        // Stempel PRZED wysyłką, tak jak licznik eskalacji: dwa przebiegi pod
        // rząd nie mogą powiadomić o tym samym przejęciu dwa razy.
        await db
          .update(panicAlerts)
          .set({ handledAt: now, handledBy: ktoPrzejal })
          .where(eq(panicAlerts.id, alert.id))

        await sendPanicSms({
          text: buildHandoverSmsText({
            portalName: alert.portalName,
            who: ktoPrzejal,
            minutes: minutyOdZgloszenia,
            taskUrl: adresZadania,
          }),
          portalId: alert.portalId,
        })

        await sendPanicDiscord(
          buildHandoverDiscordText({
            portalName: alert.portalName,
            who: ktoPrzejal,
            message: alert.message,
            minutes: minutyOdZgloszenia,
            status: statusZadania,
            taskUrl: adresZadania,
          })
        )

        await sendPanicEmails({
          subject: `✅ Alarm przejęty: ${alert.portalName} — ${ktoPrzejal}`,
          html: panicEmailHtml({
            title: '✅ Alarm przejęty',
            portalName: alert.portalName,
            message: alert.message,
            who: reporterLabel({ name: alert.userName, email: alert.userEmail ?? '' }),
            lead: `Sprawę przejął ${ktoPrzejal}, ${minutyOdZgloszenia} minut po zgłoszeniu. Zadanie ma status „${statusZadania}".`,
            taskUrl: adresZadania,
            ...(adresZadania ? { button: { url: adresZadania, label: 'Otwórz zadanie w ClickUpie →' } } : {}),
            footer: 'Portal nie będzie już przypominał o tym alarmie.',
          }),
          portalId: alert.portalId,
        })

        wyniki.push({ alertId: alert.id, escalated: false, reason: powod })
        continue
      }

      // Sprawa nieprzejęta, ale kolejne przypomnienie jeszcze nie wypada:
      // sprawdziliśmy zadanie wyłącznie po to, żeby wychwycić przejęcie.
      if (!czyWypadaEskalacja(alert)) {
        wyniki.push({ alertId: alert.id, escalated: false, reason: `czeka: ${powod}` })
        continue
      }

      // Licznik PRZED wysyłką. Cron wołany dwa razy pod rząd (ponowienie,
      // zdublowany wpis w crontabie) nie może wysłać tego samego dwa razy.
      await db
        .update(panicAlerts)
        .set({ escalationCount: alert.escalationCount + 1, escalatedAt: now })
        .where(eq(panicAlerts.id, alert.id))

      const minuty = minutyOdZgloszenia
      const taskUrl = adresZadania
      const who = reporterLabel({ name: alert.userName, email: alert.userEmail ?? '' })

      await sendPanicSms({
        text: buildEscalationSmsText({
          portalName: alert.portalName,
          message: alert.message,
          minutes: minuty,
          taskUrl,
        }),
        portalId: alert.portalId,
      })

      await sendPanicDiscord(
        buildEscalationDiscordText({
          portalName: alert.portalName,
          message: alert.message,
          who,
          minutes: minuty,
          taskUrl,
        })
      )

      await sendPanicEmails({
        subject: `🚨 ALARM BEZ REAKCJI (${minuty} min): ${alert.portalName}`,
        html: panicEmailHtml({
          title: '🚨 Alarm bez reakcji',
          portalName: alert.portalName,
          message: alert.message,
          who,
          lead: `Minęło ${minuty} minut od zgłoszenia, a poza osobą dyżurną nikt nie jest przypisany i zadanie nie ruszyło.`,
          taskUrl,
          ...(taskUrl ? { button: { url: taskUrl, label: 'Otwórz zadanie w ClickUpie →' } } : {}),
          footer: 'To jest ponowne powiadomienie wysłane automatycznie. Kolejne pójdzie po 50 minutach od zgłoszenia, potem portal zamilknie.',
        }),
        portalId: alert.portalId,
      })

      wyniki.push({ alertId: alert.id, escalated: true, reason: powod })
    }

    const eskalowane = wyniki.filter(w => w.escalated).length
    await recordCronRun({
      job: 'panic-escalation',
      ok: true,
      itemsProcessed: eskalowane,
      detail: `sprawdzono ${doSprawdzenia.length}, eskalowano ${eskalowane}`,
      startedAt,
    })

    return NextResponse.json({
      ranAt: now.toISOString(),
      checked: doSprawdzenia.length,
      escalated: eskalowane,
      results: wyniki,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Pełny ślad stosu do logu kontenera. Sam komunikat błędu potrafi wskazywać
    // na zupełnie inne miejsce niż to, które go rzuciło (14.08: „now is not
    // defined" w trasie, w której `now` jest poprawnie zadeklarowane).
    console.error('[panic-escalation] przebieg nieudany:', e)
    await recordCronRun({
      job: 'panic-escalation',
      ok: false,
      detail: `${message} | ${(e instanceof Error && e.stack ? e.stack.split('\n')[1] : '').trim()}`,
      startedAt,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
