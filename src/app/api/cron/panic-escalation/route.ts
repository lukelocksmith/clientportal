import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gte, lt } from 'drizzle-orm'
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
  clickupTaskUrl,
  isHandledTask,
  minutesSince,
  selectDueAlerts,
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
  const maxKrokow = ESCALATION_STEPS_MINUTES.length

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
      })
      .from(panicAlerts)
      .innerJoin(portals, eq(portals.id, panicAlerts.portalId))
      .where(
        and(
          lt(panicAlerts.escalationCount, maxKrokow),
          gte(panicAlerts.createdAt, new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000))
        )
      )

    const doSprawdzenia = selectDueAlerts(kandydaci, now)

    const wyniki: Array<{ alertId: string; escalated: boolean; reason: string }> = []

    for (const alert of doSprawdzenia) {
      // Brak zadania to NIE jest powód do ciszy. Zakładanie zadania jest
      // best-effort, więc pusty identyfikator znaczy „ClickUp nie odpowiedział",
      // a nie „ktoś się tym zajął".
      let przejete = false
      let powod = 'brak zadania w ClickUpie'

      if (alert.clickupTaskId) {
        try {
          const task = await getTask(alert.clickupTaskId)
          przejete = isHandledTask(task, duty)
          powod = przejete
            ? 'ktoś inny przypisany i zadanie ruszyło'
            : `przypisani: ${task.assignees?.length ?? 0}, status: ${task.status?.status ?? 'brak'}`
        } catch (e) {
          // Nie wiemy, czy ktoś przejął sprawę. Przy alarmie niewiedza ma
          // budzić, nie uciszać, więc eskalujemy i zapisujemy powód.
          powod = `ClickUp nie odpowiedział: ${e instanceof Error ? e.message : String(e)}`
        }
      }

      if (przejete) {
        wyniki.push({ alertId: alert.id, escalated: false, reason: powod })
        continue
      }

      // Licznik PRZED wysyłką. Cron wołany dwa razy pod rząd (ponowienie,
      // zdublowany wpis w crontabie) nie może wysłać tego samego dwa razy.
      await db
        .update(panicAlerts)
        .set({ escalationCount: alert.escalationCount + 1, escalatedAt: now })
        .where(eq(panicAlerts.id, alert.id))

      const minuty = minutesSince(alert.createdAt, now)
      const taskUrl = clickupTaskUrl(alert.clickupTaskId)
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
    await recordCronRun({ job: 'panic-escalation', ok: false, detail: message, startedAt })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
