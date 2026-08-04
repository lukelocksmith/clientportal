import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portalUsers, portals } from '@/lib/db/schema'
import { createSession, setSessionCookie } from '@/lib/auth'
import { setAdminSession } from '@/lib/admin-auth'
import { verifyUserPassword } from '@/lib/loginAttempts'

/**
 * Logowanie ze strony głównej, BEZ podawania projektu.
 *
 * Klient dostaje adres portalu w mailu, ale wpisuje w przeglądarkę
 * `portal.important.is` i tam do tej pory była wizytówka z tekstem „zaloguj się
 * korzystając z linku podanego przez agencję". Czyli ślepy zaułek.
 *
 * Rozstrzyganie, gdzie trafia użytkownik, dzieje się TUTAJ, po sprawdzeniu
 * hasła, a nie na podstawie tego, co poda w formularzu. Formularz nie zna
 * projektów i nie ma prawa ich znać.
 *
 * Trzy wyniki:
 *   admin   dane admina panelu           -> ustawiamy sesję admina, /admin
 *   portal  dokładnie jedno dopasowanie  -> sesja klienta, /{slug}
 *   choose  kilka dopasowań              -> BEZ sesji, lista projektów do wyboru
 *
 * Przypadek `choose` nie jest teoretyczny: kolumna `email` w `portal_users` NIE
 * jest globalnie unikalna i w bazie są konta o tym samym adresie w różnych
 * projektach. Sesja jest przypisana do konkretnego wiersza, więc nie da się
 * „zalogować do wszystkich naraz". Wybór musi być świadomy, a nie zgadnięty za
 * użytkownika, bo trafienie w zły projekt wyglądałoby jak brak danych.
 *
 * Blokada po nieudanych próbach idzie przez lib/loginAttempts.ts, wspólny
 * z logowaniem per projekt. Inaczej to wejście byłoby obejściem tamtego limitu.
 */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@important.is'
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH

/** Jedna treść odmowy na wszystkie przypadki: nie zdradzamy, czy konto istnieje. */
const ODMOWA = { error: 'Nieprawidłowy e-mail lub hasło.' }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const email: unknown = body?.email
    const password: unknown = body?.password
    // Podawany dopiero w drugim kroku, gdy użytkownik wybrał projekt z listy.
    const wybranySlug: unknown = body?.slug

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return NextResponse.json({ error: 'Podaj e-mail i hasło.' }, { status: 400 })
    }

    const normalized = email.trim().toLowerCase()

    // 1. Admin panelu. Sprawdzany PIERWSZY, bo to jego własne konto, niezależne
    //    od kont w projektach, i ma trafić do panelu, a nie do portalu klienta.
    if (ADMIN_PASSWORD_HASH && normalized === ADMIN_EMAIL.toLowerCase()) {
      if (await bcrypt.compare(password, ADMIN_PASSWORD_HASH)) {
        await setAdminSession()
        return NextResponse.json({ kind: 'admin', redirect: '/admin' })
      }
      // Zły hasło admina leci dalej: ten sam adres może być też kontem
      // w projekcie i nie chcemy odbierać mu tej drogi.
    }

    // 2. Konta w projektach. Tylko aktywne konta w aktywnych portalach.
    const kandydaci = await db
      .select({
        id: portalUsers.id,
        passwordHash: portalUsers.passwordHash,
        failedAttempts: portalUsers.failedAttempts,
        lockedUntil: portalUsers.lockedUntil,
        slug: portals.slug,
        portalName: portals.name,
      })
      .from(portalUsers)
      .innerJoin(portals, eq(portalUsers.portalId, portals.id))
      .where(and(
        eq(portalUsers.email, normalized),
        eq(portalUsers.isActive, true),
        eq(portals.isActive, true)
      ))

    if (kandydaci.length === 0) {
      return NextResponse.json(ODMOWA, { status: 401 })
    }

    const dopasowane: typeof kandydaci = []
    let zablokowane = false
    for (const k of kandydaci) {
      const wynik = await verifyUserPassword(k, password)
      if (wynik === 'ok') dopasowane.push(k)
      if (wynik === 'locked') zablokowane = true
    }

    if (dopasowane.length === 0) {
      if (zablokowane) {
        return NextResponse.json(
          { error: 'Konto jest tymczasowo zablokowane. Spróbuj za kilkanaście minut.' },
          { status: 429 }
        )
      }
      return NextResponse.json(ODMOWA, { status: 401 })
    }

    // Drugi krok: użytkownik wskazał projekt z listy.
    const cel = typeof wybranySlug === 'string'
      ? dopasowane.find(d => d.slug === wybranySlug)
      : dopasowane.length === 1
        ? dopasowane[0]
        : undefined

    if (!cel) {
      // Kilka projektów, a wybór jeszcze nie padł. Sesji NIE zakładamy, żeby
      // nie wpuścić nikogo do projektu, którego nie wskazał.
      return NextResponse.json({
        kind: 'choose',
        portals: dopasowane.map(d => ({ slug: d.slug, name: d.portalName })),
      })
    }

    const ip = request.headers.get('x-forwarded-for') ?? undefined
    const ua = request.headers.get('user-agent') ?? undefined
    await setSessionCookie(await createSession(cel.id, ip, ua))

    return NextResponse.json({ kind: 'portal', slug: cel.slug, redirect: `/${cel.slug}` })
  } catch (error) {
    console.error('[login-any] blad logowania:', error)
    return NextResponse.json({ error: 'Błąd serwera.' }, { status: 500 })
  }
}
