import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { portalUsers, sessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { z } from 'zod'

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(100).optional(),
  name: z.string().min(1).max(100).optional(),
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await params
  const parsed = patchSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.password) {
    updates.passwordHash = await bcrypt.hash(parsed.data.password, 12)
    // Zmiana hasła unieważnia istniejące sesje. Bez tego reakcja na incydent
    // („ustawcie mu nowe hasło") nie wylogowywała nikogo: stara sesja żyła
    // dalej do końca swojej ważności. Deaktywacja konta celowo NIE ubija
    // sesji — to decyzja o widoczności, nie o uwierzytelnieniu.
    await db.delete(sessions).where(eq(sessions.userId, userId))
  }

  const [user] = await db
    .update(portalUsers)
    .set(updates)
    .where(eq(portalUsers.id, userId))
    .returning({ id: portalUsers.id, email: portalUsers.email, name: portalUsers.name, isActive: portalUsers.isActive })

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json({ user })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await params
  await db.delete(portalUsers).where(eq(portalUsers.id, userId))
  return NextResponse.json({ ok: true })
}
