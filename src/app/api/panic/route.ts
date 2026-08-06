import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals, panicAlerts, portalLists } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'
import { normalizeActorId, reporterLabel, withReporterFooter } from '@/lib/reporter'
import { logEvent, EVENT_PANIC_ALERT, EVENT_TASK_CREATED } from '@/lib/portalEvents'
import { sendMail } from '@/lib/mailer'
import { createTask } from '@/lib/clickup'
import { invalidateFolderTasks } from '@/lib/clickupCache'
import { AWARIA_TAG } from '@/lib/utils'

function esc(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const DISCORD_WEBHOOK = process.env.PANIC_DISCORD_WEBHOOK_URL
/**
 * Odbiorcy alarmu. Na produkcji ustawione przez PANIC_EMAIL_TO.
 *
 * Zapas to JEDEN adres skrzynki, która na pewno istnieje. Wcześniej stały tu
 * `filip@important.is` i `paulina@important.is`, a na serwerze pocztowym są
 * `filip.g@` i `paulina.a@`. Gdyby ktoś usunął zmienną, alarm poszedłby na
 * dwa nieistniejące adresy i odbiłby się w ciszy, bo `Promise.allSettled`
 * połyka błędy z rozmysłem: jeden zły adres nie może zablokować pozostałych.
 */
const PANIC_EMAIL_TO = process.env.PANIC_EMAIL_TO ?? 'hi@important.is'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://portal.important.is'

async function sendDiscord(content: string) {
  if (!DISCORD_WEBHOOK) return
  await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch(() => {})
}

/**
 * Powiadomienia o alarmie. Idą przez WSPÓLNY lib/mailer.ts, nie przez własny
 * transport.
 *
 * Wcześniej ta trasa konfigurowała nodemailera u siebie, więc alarm był jedynym
 * mailem portalu, który NIE trafiał do rejestru wysyłek. Akurat przy alarmie
 * pytanie „czy powiadomienie do nas dotarło" jest najważniejsze, bo od niego
 * zależy, czy ktokolwiek zareagował.
 *
 * Osobne wywołanie na odbiorcę, nie jedno z listą: chcemy wiedzieć, do kogo
 * dotarło, a nie tylko że „coś wyszło".
 */
async function sendEmails(subject: string, body: string, portalId: string) {
  const recipients = PANIC_EMAIL_TO.split(',').map(e => e.trim()).filter(Boolean)
  await Promise.allSettled(
    recipients.map(to => sendMail({ to, subject, html: body, kind: 'panic', portalId }))
  )
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
}) {
  try {
    const lists = await db
      .select()
      .from(portalLists)
      .where(eq(portalLists.portalId, input.portalId))
      .orderBy(portalLists.sortOrder)
    const targetListId = (lists.find(l => l.isDefault) ?? lists[0])?.clickupListId
    if (!targetListId) return

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
    })

    await invalidateFolderTasks(input.folderId)

    await logEvent({
      portalId: input.portalId,
      actor: input.session,
      action: EVENT_TASK_CREATED,
      resourceId: task.id,
      meta: { source: 'panic', taskName: task.name, url: task.url ?? null, priority: 1, awaria: true },
    })
  } catch (e) {
    console.error('[panic] nie udało się założyć zadania w ClickUpie:', e)
  }
}

export async function POST(request: NextRequest) {
  const { slug, message } = await request.json()
  const session = await getSession(slug)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.portalSlug !== slug) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!message?.trim()) {
    return NextResponse.json({ error: 'Message required' }, { status: 400 })
  }

  const portal = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ackToken = crypto.randomBytes(32).toString('hex')

  const [alert] = await db.insert(panicAlerts).values({
    portalId: portal[0].id,
    userId: normalizeActorId(session.userId),
    userEmail: session.email,
    userName: session.name,
    message: message.trim(),
    ackToken,
  }).returning()

  await logEvent({
    portalId: portal[0].id,
    actor: { userId: session.userId, email: session.email, name: session.name },
    action: EVENT_PANIC_ALERT,
    resourceId: alert.id,
    meta: { message: message.trim().slice(0, 200) },
  })

  const ackUrl = `${APP_URL}/api/panic/${alert.id}/ack?token=${ackToken}`

  // Kto wcisnął. Przy alarmie to jest najważniejsza informacja po samej treści:
  // reakcją jest telefon do konkretnej osoby, a nie „do klienta".
  const who = reporterLabel({ name: session.name, email: session.email })

  // Discord notification
  await sendDiscord(
    `🚨 **ALARM od klienta ${portal[0].name}!**\n\n` +
    `> ${message.trim()}\n\n` +
    `**Zgłasza:** ${who}\n\n` +
    `**Kliknij żeby potwierdzić że się tym zajmujesz:**\n${ackUrl}`
  )

  // Email notification
  const emailSubject = `🚨 ALARM: ${portal[0].name} — ${message.trim().slice(0, 60)}`
  const emailBody = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#ef4444;color:white;padding:20px;border-radius:8px 8px 0 0">
        <h1 style="margin:0;font-size:24px">🚨 ALARM od klienta</h1>
        <p style="margin:8px 0 0;opacity:0.9">${esc(portal[0].name)}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 8px 8px">
        <p style="font-size:16px;color:#111827;margin-top:0">${esc(message.trim())}</p>
        <p style="font-size:14px;color:#374151;margin:0">
          <strong>Zgłasza:</strong> ${esc(who)}
        </p>
        <a href="${esc(ackUrl)}" style="display:inline-block;background:#ef4444;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px">
          Zajmuję się tym →
        </a>
        <p style="color:#6b7280;font-size:12px;margin-top:24px">
          Ten link potwierdza że reagujesz na alarm. Po kliknięciu klient zobaczy że ktoś się tym zajmuje.
        </p>
      </div>
    </div>
  `

  await sendEmails(emailSubject, emailBody, portal[0].id)

  await createAlarmTask({
    portalId: portal[0].id,
    portalName: portal[0].name,
    portalSlug: portal[0].slug,
    folderId: portal[0].clickupFolderId,
    message: message.trim(),
    session: { userId: session.userId, email: session.email, name: session.name },
  })

  return NextResponse.json({ ok: true, alertId: alert.id })
}

// GET /api/panic/status?alertId=xxx — check if acknowledged
export async function GET(request: NextRequest) {
  const alertId = request.nextUrl.searchParams.get('alertId')
  if (!alertId) return NextResponse.json({ error: 'Missing alertId' }, { status: 400 })

  const alert = await db.select().from(panicAlerts).where(eq(panicAlerts.id, alertId)).limit(1)
  if (!alert[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    acknowledged: !!alert[0].acknowledgedAt,
    acknowledgedBy: alert[0].acknowledgedBy,
    acknowledgedAt: alert[0].acknowledgedAt,
  })
}
