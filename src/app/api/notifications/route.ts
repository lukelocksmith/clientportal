import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePortalApi } from '@/lib/apiSession'
import { countUnread, listForUser, markRead } from '@/lib/notificationStore'
import { normalizeActorId } from '@/lib/reporter'

/**
 * Dzwonek w portalu: lista powiadomień i licznik nieprzeczytanych.
 *
 * Sesja admina przeglądającego cudzy portal ma `userId: 'admin'`, czyli nie
 * UUID, a `notifications.user_id` wskazuje na `portal_users`. Admin nie ma
 * więc i nie może mieć własnych powiadomień. Zwracamy mu pustą listę zamiast
 * błędu: podgląd portalu ma działać, tylko dzwonek jest wtedy pusty.
 */
function ownUserId(sessionUserId: string): string | null {
  return normalizeActorId(sessionUserId)
}

export async function GET(request: NextRequest) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response

  const userId = ownUserId(gate.session.userId)
  if (!userId) return NextResponse.json({ unread: 0, items: [], adminPreview: true })

  const [unread, items] = await Promise.all([countUnread(userId), listForUser(userId)])

  return NextResponse.json({
    unread,
    items: items.map(n => ({
      id: n.id,
      kind: n.kind,
      taskId: n.clickupTaskId,
      taskName: n.taskName,
      payload: n.payload,
      createdAt: n.createdAt,
      read: n.readAt != null,
    })),
  })
}

const markSchema = z.object({
  slug: z.string().min(1).max(50),
  /** Puste znaczy „oznacz wszystkie moje jako przeczytane". */
  ids: z.array(z.string().uuid()).optional(),
})

export async function POST(request: NextRequest) {
  const parsed = markSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const gate = await requirePortalApi(parsed.data.slug)
  if (!gate.ok) return gate.response

  const userId = ownUserId(gate.session.userId)
  if (!userId) return NextResponse.json({ ok: true, adminPreview: true })

  // markRead sam wiąże warunek z `userId`, więc identyfikator z przeglądarki
  // nie oznaczy cudzego powiadomienia.
  await markRead(userId, parsed.data.ids)
  return NextResponse.json({ ok: true, unread: await countUnread(userId) })
}
