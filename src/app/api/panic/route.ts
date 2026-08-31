import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { panicAlerts, portalLists } from '@/lib/db/schema'
import { and, desc, eq, ne } from 'drizzle-orm'
import { requirePortalApi } from '@/lib/apiSession'
import { normalizeActorId, newReportMarker, reporterLabel, withReporterFooter } from '@/lib/reporter'
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
import { assigneesField } from '@/lib/assignee'
import { invalidateFolderTasks } from '@/lib/clickupCache'
import { AWARIA_TAG, TASK_STATUS_INITIAL } from '@/lib/utils'
import { enqueueReport } from '@/lib/pendingReports'
import { sendOpsAlert } from '@/lib/cronRuns'

/**
 * Ile czekamy na ClickUpa, zanim wyślemy alarm bez linku do zadania.
 * Osiem sekund: tyle, żeby zdążył przy normalnej pracy, i na tyle mało,
 * żeby klient w panice nie patrzył w kręcące się kółko.
 */
const CLICKUP_TIMEOUT_MS = 8_000

/**
 * Walidacja wejścia. Górna granica treści istnieje, bo wiadomość leci do bazy,
 * maila, Discorda i SMS-a: bez limitu przejęte konto mogłoby wygenerować koszt
 * SMS-owy dowolnej wielkości. 2000 znaków to kilkukrotność realnego zgłoszenia.
 */
const panicSchema = z.object({
  slug: z.string().min(1).max(100),
  message: z.string().min(1).max(2000),
})

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
  /** Adres zadania w ClickUpie, null gdy nie powstało. */
  taskUrl: string | null
}): Promise<boolean> {
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
      // Pominięty przez dławik NIE liczy się jako dostarczony.
      //
      // Pytanie brzmi „czy TEN alarm do kogoś dotarł", a nie „czy telefon
      // zawibrował kiedykolwiek". Fałszywy alarm operacyjny (poprzedni SMS
      // poszedł cztery minuty temu, więc ludzie wiedzą) kosztuje jedną
      // wiadomość na Discordzie. Cisza w drugą stronę kosztuje niezauważony
      // alarm klienta.
      return false
    }

    const wyniki = await sendPanicSmsToTeam({
      text: buildPanicSmsText({
        portalName: input.portalName,
        message: input.message,
        who: input.who,
        taskUrl: input.taskUrl,
      }),
      portalId: input.portalId,
    })
    return wyniki
  } catch (e) {
    console.error('[panic] nie udało się wysłać SMS-a alarmowego:', e)
    return false
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
  /** Opiekun projektu — zapas, gdy nie ma dyzurnego (lib/assignee.ts). */
  defaultAssigneeId: number | null
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
    if (!targetListId) {
      // Projekt bez listy nie ma gdzie przyjąć zadania i nie naprawi się sam.
      // Cicha `null` znaczyłaby alarm bez zadania i bez śladu, dlaczego.
      await sendOpsAlert(
        `🔴 **Alarm bez zadania: projekt \`${input.portalSlug}\` nie ma skonfigurowanej listy ClickUpa**\n` +
          `Zadanie trzeba założyć ręcznie, a listę wpisać w panelu.`
      )
      return null
    }

    // Pierwsza linia zgłoszenia jako nazwa. Klient w panice pisze ciągiem, więc
    // bez ucięcia nazwa zadania byłaby akapitem. Pełna treść jest w opisie.
    const marker = newReportMarker()
    const firstLine = input.message.split('\n')[0].trim()
    const name = `🚨 ALARM: ${firstLine.slice(0, 70)}${firstLine.length > 70 ? '…' : ''}`

    const payload = {
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
          marker,
        }
      ),
      priority: 1,
      tags: [AWARIA_TAG],
      status: TASK_STATUS_INITIAL,
      /**
       * Osoba dyżurna od razu przy tworzeniu. Zadanie bez właściciela czeka na
       * to, aż ktoś je zobaczy, a alarm nie ma czasu na „ktoś to weźmie".
       *
       * DYŻURNY WYGRYWA z ustawieniem projektu i tak ma zostać: przy alarmie
       * liczy się czas reakcji, a nie to, kto zwykle prowadzi ten projekt.
       * Opiekun projektu wchodzi dopiero jako zapas, gdy dyżuru nie ustawiono —
       * to i tak lepiej niż alarm bez nikogo.
       */
      ...(dyzurny ? { assignees: [dyzurny] } : assigneesField(input.defaultAssigneeId)),
    }

    let task: Awaited<ReturnType<typeof createTask>>
    try {
      task = await createTask(targetListId, payload)
    } catch (e) {
      /**
       * ZADANIE ALARMOWE IDZIE DO KOLEJKI, nie do kosza (31.08).
       *
       * Alarmy z 11.08 i 13.08 leżą w `panic_alerts` z `clickup_task_id`
       * równym NULL: powiadomienia poszły, zadanie nie powstało i NIC go nigdy
       * nie ponowiło. Zespół widział maila, a klient patrzył na tablicę, na
       * której jego najpilniejszej sprawy nie było. Eskalacja też nie miała
       * czego pytać o przypisanych, bo pyta po id zadania.
       */
      console.error('[panic] ClickUp odrzucił zadanie alarmowe, idzie do kolejki:', e)
      await enqueueReport({
        portalId: input.portalId,
        source: 'panic',
        clickupListId: targetListId,
        payload,
        marker,
        actor: { userId: normalizeActorId(input.session.userId), email: input.session.email, name: input.session.name },
        panicAlertId: input.alertId,
        error: e,
      })
      return null
    }

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
    // Cokolwiek innego padło po drodze (baza, historia, unieważnienie bufora).
    // Zadanie mogło już powstać, więc tu tylko log: ponawianie należy do
    // kolejki, a nie do tej funkcji.
    console.error('[panic] nie udało się dokończyć zakładania zadania alarmowego:', e)
    return null
  }
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null)
  const parsed = panicSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Message required (max 2000 znaków)' }, { status: 400 })
  }
  const { slug, message } = parsed.data
  const gate = await requirePortalApi(slug)
  if (!gate.ok) return gate.response
  const { session, portal } = gate

  if (!message.trim()) {
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

  /**
   * ZADANIE POWSTAJE PRZED POWIADOMIENIAMI (zmiana z 2026-08-14).
   *
   * Powód: powiadomienie ma nieść LINK do zadania, a nie samą treść zgłoszenia,
   * żeby dało się przejść do sprawy jednym kliknięciem z telefonu.
   *
   * Cena tej kolejności jest jawna: alarm czeka na ClickUpa. Dlatego czeka
   * NAJWYŻEJ 8 SEKUND. Po tym czasie powiadomienia idą bez linku, z adnotacją,
   * że zadania nie ma. Awaria ClickUpa nie może uciszyć alarmu ani kazać
   * klientowi patrzeć w kręcące się kółko.
   */
  const taskId = await Promise.race([
    createAlarmTask({
      portalId: portal.id,
      portalName: portal.name,
      portalSlug: portal.slug,
      folderId: portal.clickupFolderId,
      defaultAssigneeId: portal.defaultAssigneeId,
      message: message.trim(),
      session: { userId: session.userId, email: session.email, name: session.name },
      alertId: alert.id,
    }),
    new Promise<null>(resolve => setTimeout(() => resolve(null), CLICKUP_TIMEOUT_MS)),
  ])

  const taskUrl = taskId ? `https://app.clickup.com/t/${taskId}` : null

  // Discord notification
  // Trzy kanały powiadomień są niezależne i best-effort, więc lecą równolegle:
  // sekwencyjny await sumowałby latencje Discorda, SMTP i bramki SMS na czasie
  // reakcji klienta. allSettled, bo porażka jednego kanału nie może zatrzymać
  // pozostałych ani odpowiedzi do klienta.
  const discordText =
    `🚨 **ALARM od klienta ${portal.name}!**\n\n` +
    `> ${message.trim()}\n\n` +
    `**Zgłasza:** ${who}\n\n` +
    (taskUrl ? `**Zadanie:** ${taskUrl}` : '**Zadanie:** nie powstało w ClickUpie, sprawdź ręcznie')

  const kanaly = await Promise.allSettled([
    sendPanicDiscord(discordText),
    sendPanicEmails({
      subject: `🚨 ALARM: ${portal.name} — ${message.trim().slice(0, 60)}`,
      html: panicEmailHtml({
        title: '🚨 ALARM od klienta',
        portalName: portal.name,
        message: message.trim(),
        who,
        taskUrl,
        ...(taskUrl ? { button: { url: taskUrl, label: 'Otwórz zadanie w ClickUpie →' } } : {}),
        footer: taskUrl
          ? 'Zadanie jest już na tablicy z przypisaną osobą dyżurną. Jeśli przez 25 minut nikt inny go nie przejmie, portal przypomni SMS-em.'
          : 'UWAGA: zadanie w ClickUpie NIE powstało, trzeba je założyć ręcznie.',
      }),
      portalId: portal.id,
    }),
    sendPanicSms({
      portalId: portal.id,
      portalName: portal.name,
      message: message.trim(),
      who,
      currentAlertId: alert.id,
      taskUrl,
    }),
  ])

  /**
   * WYNIK WYSYŁKI JEST CZYTANY (31.08). Do tej pory `allSettled` służyło
   * wyłącznie do tego, żeby porażka jednego kanału nie zatrzymała pozostałych,
   * a jego rezultat leciał do kosza. Alarm, o którym nie dowiedział się NIKT,
   * wyglądał w bazie identycznie jak alarm ogłoszony na trzech kanałach.
   *
   * Stempel na wierszu alarmu jest tym, po co sięga eskalacja, żeby ponowić
   * ogłoszenie. Alarm operacyjny idzie osobno, bo to jest jedyna sytuacja,
   * w której klient wcisnął czerwony przycisk i nie zawibrował żaden telefon.
   */
  const nazwyKanalow = ['Discord', 'mail', 'SMS']
  /**
   * Liczymy DOSTARCZENIA, nie odrzucone obietnice.
   *
   * Wszystkie trzy funkcje wysyłkowe łykają swoje błędy, więc ich obietnice
   * ZAWSZE kończą się sukcesem — patrzenie na `status === 'rejected'` mierzyłoby
   * wyłącznie to, czy kod się wykonał, i zawsze pokazywałoby zieleń. Dlatego
   * każda z nich zwraca teraz `boolean`: „co najmniej jeden odbiorca dostał".
   */
  const padly = kanaly
    .map((k, i) => (k.status === 'fulfilled' && k.value === true ? null : nazwyKanalow[i]))
    .filter((n): n is string => n !== null)

  if (padly.length === kanaly.length) {
    console.error(`[panic] ŻADEN kanał powiadomień nie zadziałał dla alarmu ${alert.id}`)
    await db
      .update(panicAlerts)
      .set({ notifyFailedAt: new Date() })
      .where(eq(panicAlerts.id, alert.id))
    // Ostatnia deska ratunku. Idzie tym samym webhookiem co reszta, więc gdy
    // padł właśnie Discord, zostaje log — i eskalacja, która ponowi za 5 minut.
    await sendOpsAlert(
      `🔴 **ALARM KLIENTA BEZ POWIADOMIENIA: ${portal.name}**\n` +
        `Padły wszystkie kanały (${padly.join(', ')}).\n` +
        `Treść: ${message.trim().slice(0, 300)}\n` +
        `Zgłasza: ${who}` +
        (taskUrl ? `\nZadanie: ${taskUrl}` : '\nZadanie: NIE powstało.')
    )
  } else if (padly.length > 0) {
    console.warn(`[panic] kanały nieudane dla alarmu ${alert.id}: ${padly.join(', ')}`)
  }

  return NextResponse.json({ ok: true, alertId: alert.id })
}
