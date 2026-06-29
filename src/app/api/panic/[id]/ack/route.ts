import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { panicAlerts, portals } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

function esc(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return new NextResponse(errorPage('Brakuje tokenu potwierdzenia.'), { headers: { 'Content-Type': 'text/html' } })
  }

  const alert = await db
    .select({ alert: panicAlerts, portalName: portals.name, portalSlug: portals.slug })
    .from(panicAlerts)
    .innerJoin(portals, eq(portals.id, panicAlerts.portalId))
    .where(and(eq(panicAlerts.id, id), eq(panicAlerts.ackToken, token)))
    .limit(1)

  if (!alert[0]) {
    return new NextResponse(errorPage('Link nieważny lub już wykorzystany.'), { headers: { 'Content-Type': 'text/html' } })
  }

  if (alert[0].alert.acknowledgedAt) {
    return new NextResponse(
      successPage(alert[0].portalName, alert[0].alert.acknowledgedBy ?? 'ktoś', alert[0].alert.message, true),
      { headers: { 'Content-Type': 'text/html' } }
    )
  }

  // Mark as acknowledged — use user-agent as rough identifier
  const ua = request.headers.get('user-agent') ?? 'unknown'
  const acknowledgedBy = ua.includes('Mobile') ? 'telefon' : 'komputer'

  await db
    .update(panicAlerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy })
    .where(eq(panicAlerts.id, id))

  return new NextResponse(
    successPage(alert[0].portalName, acknowledgedBy, alert[0].alert.message, false),
    { headers: { 'Content-Type': 'text/html' } }
  )
}

function successPage(portalName: string, who: string, message: string, alreadyAcked: boolean) {
  const title = alreadyAcked ? 'Alarm już potwierdzony' : 'Potwierdzono!'
  const sub = alreadyAcked
    ? `Ten alarm był już wcześniej potwierdzony.`
    : `Klient ${esc(portalName)} zobaczy że ktoś się tym zajmuje.`

  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}.card{background:white;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:40px;max-width:480px;width:100%;text-align:center}.icon{font-size:48px;margin-bottom:16px}h1{font-size:22px;color:#111827;margin-bottom:8px}p{color:#6b7280;line-height:1.6;margin-bottom:8px}.msg{background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin:20px 0;font-size:14px;color:#92400e;text-align:left}</style></head><body><div class="card"><div class="icon">✅</div><h1>${esc(title)}</h1><p>${sub}</p><div class="msg"><strong>Zgłoszenie:</strong><br>${esc(message)}</div><p style="font-size:13px;color:#9ca3af">Możesz zamknąć tę stronę.</p></div></body></html>`
}

function errorPage(msg: string) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Błąd</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}.card{background:white;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:40px;max-width:480px;width:100%;text-align:center}.icon{font-size:48px;margin-bottom:16px}h1{font-size:22px;color:#111827;margin-bottom:8px}p{color:#6b7280}</style></head><body><div class="card"><div class="icon">⚠️</div><h1>Błąd</h1><p>${esc(msg)}</p></div></body></html>`
}
