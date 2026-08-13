import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { panicAlerts, portalLists } from '@/lib/db/schema'
import { and, desc, eq, ne } from 'drizzle-orm'
import { requirePortalApi } from '@/lib/apiSession'
import { normalizeActorId, reporterLabel, withReporterFooter } from '@/lib/reporter'
import { logEvent, EVENT_PANIC_ALERT, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import {
  panicEmailHtml,
  sendPanicDiscord,
  sendPanicEmails,
  sendPanicSms as sendPanicSmsToTeam,
} from '@/lib/panicNotify'
import { buildPanicSmsText, isWithinThrottleWindow, PANIC_SMS_THROTTLE_MINUTES } from '@/lib/sms'
import { DUTY_ASSIGNEE_ID } from '@/lib/panicDuty'
import { createTask } from '@/lib/clickup'
import { invalidateFolderTasks } from '@/lib/clickupCache'
import { AWARIA_TAG } from '@/lib/utils'

/**
 * SMS do zespołu przez własną bramkę (`sms.important.is`).
 *
 * Trzeci kanał obok maila i Discorda, bo dwa pierwsze wymagają, żeby ktoś
 * patrzył w ekran. Alarm bywa wciśnięty w sobotę wieczorem i wtedy jedyne, co
 * na pewno zawibruje w kieszeni, to SMS.
 *
 * Cała funkcja jest BEST-EFFORT i nigdy nie przerywa trasy: klient nie może
 * dostać błędu przy alarmie dlatego, że telefon bramki akurat się restartuje.
 *
 * Odbiorcy siedzą w `PANIC_SMS_TO` (numery po przecinku), a nie w `TEAM_MEMBERS`.
 * To są dwie różne listy, dziś przypadkiem te same osoby: `TEAM_MEMBERS` to
 * kontakt POKAZYWANY klientowi, a tu chodzi o to, kogo wyrwać od stołu.
 * Pusta zmienna wyłącza kanał, bez żadnego błędu.
 */
async function sendPanicSms(input: {
  portalId: string
  portalName: string
  message: string
  who: string
  /** Alarm zapisany przed chwilą. Wykluczamy go z pytania o poprzedni. */
  currentAlertId: string
}) {
  try {
    // Dławik: klient w panice wciska przycisk kilka razy pod rząd, a karta w
    // bramce jest zwykłym abonamentem konsumenckim. Mail i Discord idą zawsze,
    // ograniczony jest WYŁĄCZNIE SMS.
    const [poprzedni] = await db
      .select({ createdAt: panicAlerts.createdAt })
      .from(panicAlerts)
      .where(and(eq(panicAlerts.portalId, input.portalId), ne(panicAlerts.id, input.currentAlertId)))
      .orderBy(desc(panicAlerts.createdAt))
      .limit(1)

    if (isWithinThrottleWindow(poprzedni?.createdAt ?? null, new Date())) {
      console.info(
        `[panic] SMS pominięty: poprzedni alarm w tym projekcie był mniej niż ${PANIC_SMS_THROTTLE_MINUTES} min temu`
      )
      return
    }

    await sendPanicSmsToTeam({
      text: buildPanicSmsText({
        portalName: input.portalName,
        message: input.message,
        who: input.who,
      }),
      portalId: input.portalId,
    })
  } catch (e) {
    console.error('[panic] nie udało się wysłać SMS-a alarmowego:', e)
  }
}

/**
 * Zadanie w ClickUpie za wciśniętym alarmem.
 *
 * Alarm dotąd zostawiał ślad tylko w mailu i w tabeli `panic_alerts`, więc na
 * tablicy nie było po nim nic: zespół widział zgłoszenie w skrzynce, a klient
 * patrzył na kanban, na którym jego najpilniejsza sprawa nie istniała.
 *
 * Zadanie dostaje priorytet `urgent` ORAZ tag awarii. Sam priorytet by nie
 * wystarczył, bo `urgent` to teraz zwykłe P1 i alarm nie odróżniłby się od
 * istotnej usterki; sam tag też nie, bo zadanie wylądowałoby nisko w sortowaniu.
 *
 * Cała funkcja jest BEST-EFFORT i świadomie NIE przerywa trasy. Powiadomienie
 * jest ważniejsze od zadania: gdyby ClickUp nie odpowiedział, klient nie może
 * dostać błędu przy alarmie, skoro mail i Discord już poszły. Dlatego wołamy ją
 * PO wysyłce i łykamy wyjątek do logu.
 */
async function createAlarmTask(input: {
  portalId: string
  portalName: string
  portalSlug: string
  folderId: string
  message: string
  // `name` bywa nullem: zaproszenie mogło pójść bez imienia (patrz Reporter).
  session: { userId: string; email: string; name: string | null }
  /** Alarm, do którego dopiszemy id zadania. */
  alertId: string
}): Promise<string | null> {
  const dyzurny = DUTY_ASSIGNEE_ID()
  try {
    const lists = await db
      .select()
      .from(portalLists)
      .where(eq(portalLists.portalId, input.portalId))
      .orderBy(portalLists.sortOrder)
    const targetListId = (lists.find(l => l.isDefault) ?? lists[0])?.clickupListId
    if (!targetListId) return null

    // Pierwsza linia zgłoszenia jako nazwa. Klient w panice pisze ciągiem, więc
    // bez ucięcia nazwa zadania byłaby akapitem. Pełna treść jest w opisie.
    const firstLine = input.message.split('\n')[0].trim()
    const name = `🚨 ALARM: ${firstLine.slice(0, 70)}${firstLine.length > 70 ? '…' : ''}`

    const task = await createTask(targetListId, {
      name,
      description: withReporterFooter(
        `## Zgłoszenie alarmowe\n\n${input.message}\n\n` +
          `Zgłoszone czerwonym przyciskiem Alarm w portalu. Powiadomienie poszło mailem i na Discorda w chwili wciśnięcia.`,
        {
          name: input.session.name,
          email: input.session.email,
          portalName: input.portalName,
          portalSlug: input.portalSlug,
          source: 'panic',
        }
      ),
      priority: 1,
      tags: [AWARIA_TAG],
      status: 'do zrobienia',
      // Osoba dyżurna od razu przy tworzeniu. Zadanie bez właściciela czeka na
      // to, aż ktoś je zobaczy, a alarm nie ma czasu na „ktoś to weźmie".
      ...(dyzurny ? { assignees: [dyzurny] } : {}),
    })

    // Id zadania w naszej tabeli, bo bez niego eskalacja po 25 minutach nie ma
    // czego zapytać o przypisanych.
    await db
      .update(panicAlerts)
      .set({ clickupTaskId: task.id })
      .where(eq(panicAlerts.id, input.alertId))

    await invalidateFolderTasks(input.folderId)

    await logEvent({
      portalId: input.portalId,
      actor: input.session,
      action: EVENT_TASK_CREATED,
      resourceId: task.id,
      meta: {
        source: 'panic',
        taskName: task.name,
        url: task.url ?? null,
        priority: 1,
        awaria: true,
        assignee: dyzurny,
      },
    })

    return task.id
  } catch (e) {
    console.error('[panic] nie udało się założyć zadania w ClickUpie:', e)
    return null
  }
}

export async function POST(request: NextRequest) {
  const { slug, message } = await request.json()
  const gate = await requirePortalApi(slug)
  if (!gate.ok) return gate.response
  const { session, portal } = gate

  if (!message?.trim()) {
    return NextResponse.json({ error: 'Message required' }, { status: 400 })
  }

  const [alert] = await db.insert(panicAlerts).values({
    portalId: portal.id,
    userId: normalizeActorId(session.userId),
    userEmail: session.email,
    userName: session.name,
    message: message.trim(),
  }).returning()

  await logEvent({
    portalId: portal.id,
    actor: { userId: session.userId, email: session.email, name: session.name },
    action: EVENT_PANIC_ALERT,
    resourceId: alert.id,
    meta: { message: message.trim().slice(0, 200) },
  })

  // Kto wcisnął. Przy alarmie to jest najważniejsza informacja po samej treści:
  // reakcją jest telefon do konkretnej osoby, a nie „do klienta".
  const who = reporterLabel({ name: session.name, email: session.email })

  // Discord notification
  await sendPanicDiscord(
    `🚨 **ALARM od klienta ${portal.name}!**\n\n` +
    `> ${message.trim()}\n\n` +
    `**Zgłasza:** ${who}`
  )

  // Email notification
  await sendPanicEmails({
    subject: `🚨 ALARM: ${portal.name} — ${message.trim().slice(0, 60)}`,
    html: panicEmailHtml({
      title: '🚨 ALARM od klienta',
      portalName: portal.name,
      message: message.trim(),
      who,
      footer: 'Zadanie awaryjne jest już na tablicy z przypisaną osobą dyżurną. Jeśli przez 25 minut nikt inny nie weźmie sprawy, portal przypomni SMS-em.',
    }),
    portalId: portal.id,
  })

  await sendPanicSms({
    portalId: portal.id,
    portalName: portal.name,
    message: message.trim(),
    who,
    currentAlertId: alert.id,
  })

  await createAlarmTask({
    portalId: portal.id,
    portalName: portal.name,
    portalSlug: portal.slug,
    folderId: portal.clickupFolderId,
    message: message.trim(),
    session: { userId: session.userId, email: session.email, name: session.name },
    alertId: alert.id,
  })

  return NextResponse.json({ ok: true, alertId: alert.id })
}
