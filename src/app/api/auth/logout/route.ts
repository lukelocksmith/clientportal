import { NextResponse } from 'next/server'
import { deleteSessionCookie } from '@/lib/auth'

export async function POST() {
  await deleteSessionCookie()
  return NextResponse.json({ ok: true })
}
