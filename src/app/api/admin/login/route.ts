import { NextRequest, NextResponse } from 'next/server'
import { setAdminSession } from '@/lib/admin-auth'

export async function POST(request: NextRequest) {
  const { secret } = await request.json()
  const ADMIN_SECRET = process.env.ADMIN_SECRET

  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  }

  await setAdminSession()
  return NextResponse.json({ ok: true })
}
