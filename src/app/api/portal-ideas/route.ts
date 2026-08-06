import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePortalApi } from '@/lib/apiSession'
import {
  submitIdea,
  ideaSubmittedRecently,
  IDEA_MIN_LENGTH,
  IDEA_MAX_LENGTH,
  IDEA_COOLDOWN_MINUTES,
} from '@/lib/portalIdeas'

/**
 * Pomysł klienta na ulepszenie portalu.
 *
 * Wymaga sesji w TYM portalu, bo `slug` decyduje, w imieniu którego projektu
 * pomysł zostanie podpisany. Bez tego sprawdzenia każdy zalogowany klient
 * mógłby wysyłać zgłoszenia podpisane cudzym projektem.
 */
const schema = z.object({
  slug: z.string().min(1).max(50),
  text: z.string().min(IDEA_MIN_LENGTH).max(IDEA_MAX_LENGTH),
})

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Napisz od ${IDEA_MIN_LENGTH} do ${IDEA_MAX_LENGTH} znaków.` },
      { status: 400 }
    )
  }

  const { slug, text } = parsed.data

  const gate = await requirePortalApi(slug)
  if (!gate.ok) return gate.response
  const { session, portal } = gate

  // Admin przeglądający portal ma userId 'admin', czyli nie uuid. Do audit_log
  // wchodzi wtedy null, bo klucz obcy wskazuje na portal_users.
  const userId = session.userId === 'admin' ? null : session.userId

  if (userId && (await ideaSubmittedRecently(userId))) {
    return NextResponse.json(
      { error: `Dzięki! Poczekaj ${IDEA_COOLDOWN_MINUTES} minuty przed kolejnym pomysłem.` },
      { status: 429 }
    )
  }

  const outcome = await submitIdea({
    userId,
    portalId: portal.id,
    portalName: portal.name,
    portalSlug: portal.slug,
    authorEmail: session.email,
    authorName: session.name,
    text,
  })

  if (!outcome.ok) {
    if (outcome.reason === 'not-configured') {
      // Pomysł JEST zapisany u nas, tylko nie trafił do ClickUpa, bo brakuje
      // konfiguracji. To nasz problem, nie klienta, więc mówimy mu prawdę:
      // dotarło.
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Nie udało się zapisać pomysłu.' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
