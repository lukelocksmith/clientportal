import { NextRequest, NextResponse } from 'next/server'
import { setAdminSession } from '@/lib/admin-auth'
import bcrypt from 'bcryptjs'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@important.is'
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH

// Fallback: legacy ADMIN_SECRET for migration period
const ADMIN_SECRET = process.env.ADMIN_SECRET

export async function POST(request: NextRequest) {
  const { email, password, secret } = await request.json()

  // Legacy secret-based login
  if (secret && ADMIN_SECRET && secret === ADMIN_SECRET) {
    await setAdminSession()
    return NextResponse.json({ ok: true })
  }

  // Email + password login
  if (!email || !password) {
    return NextResponse.json({ error: 'Email i hasło są wymagane' }, { status: 401 })
  }

  if (email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Nieprawidłowy email lub hasło' }, { status: 401 })
  }

  if (ADMIN_PASSWORD_HASH) {
    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH)
    if (!valid) return NextResponse.json({ error: 'Nieprawidłowy email lub hasło' }, { status: 401 })
  } else if (ADMIN_SECRET) {
    // No hash set yet — compare against plain secret
    if (password !== ADMIN_SECRET) return NextResponse.json({ error: 'Nieprawidłowy email lub hasło' }, { status: 401 })
  } else {
    return NextResponse.json({ error: 'Admin not configured' }, { status: 500 })
  }

  await setAdminSession()
  return NextResponse.json({ ok: true })
}
