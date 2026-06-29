import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET

export async function POST(request: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.error('[webhook] CLICKUP_WEBHOOK_SECRET is not set — rejecting all webhooks')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const signature = request.headers.get('x-signature')
  const body = await request.text()

  const expected = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
  const signatureOk = signature != null &&
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'))

  if (!signatureOk) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: { event: string; task_id?: string; webhook_id?: string; history_items?: Array<{ field: string }> }
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const taskEvents = ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskStatusUpdated', 'taskPriorityUpdated']
  if (taskEvents.includes(payload.event)) {
    const allPortals = await db.select({ slug: portals.slug }).from(portals)
    for (const { slug } of allPortals) {
      revalidatePath(`/${slug}`)
    }
  }

  return NextResponse.json({ ok: true })
}
