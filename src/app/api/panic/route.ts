import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { portals, panicAlerts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'

function esc(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const DISCORD_WEBHOOK = process.env.PANIC_DISCORD_WEBHOOK_URL
const PANIC_EMAIL_TO = process.env.PANIC_EMAIL_TO ?? 'lukasz.s@important.is,filip@important.is,paulina@important.is'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://portal.important.is'

async function sendDiscord(content: string) {
  if (!DISCORD_WEBHOOK) return
  await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch(() => {})
}

async function sendEmails(subject: string, body: string) {
  const smtpHost = process.env.SMTP_HOST
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS

  if (!smtpHost || !smtpUser || !smtpPass) return

  const recipients = PANIC_EMAIL_TO.split(',').map(e => e.trim()).filter(Boolean)

  const { createTransport } = await import('nodemailer')
  const transport = createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  })

  await Promise.allSettled(
    recipients.map(to =>
      transport.sendMail({
        from: smtpUser,
        to,
        subject,
        html: body,
      })
    )
  )
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
    message: message.trim(),
    ackToken,
  }).returning()

  const ackUrl = `${APP_URL}/api/panic/${alert.id}/ack?token=${ackToken}`

  // Discord notification
  await sendDiscord(
    `🚨 **ALARM od klienta ${portal[0].name}!**\n\n` +
    `> ${message.trim()}\n\n` +
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
        <a href="${esc(ackUrl)}" style="display:inline-block;background:#ef4444;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px">
          Zajmuję się tym →
        </a>
        <p style="color:#6b7280;font-size:12px;margin-top:24px">
          Ten link potwierdza że reagujesz na alarm. Po kliknięciu klient zobaczy że ktoś się tym zajmuje.
        </p>
      </div>
    </div>
  `

  await sendEmails(emailSubject, emailBody)

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
