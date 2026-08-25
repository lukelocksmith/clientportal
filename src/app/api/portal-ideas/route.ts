import { NextRequest, NextResponse } from 'next/server'
import { requirePortalApi } from '@/lib/apiSession'
import {
  submitIdea,
  ideaSubmittedRecently,
  IDEA_MIN_LENGTH,
  IDEA_MAX_LENGTH,
  IDEA_COOLDOWN_MINUTES,
} from '@/lib/portalIdeas'

export const runtime = 'nodejs'

// Te same limity co przy zalacznikach zadania (attachments/route.ts) — jeden
// mechanizm uploadu, dwa miejsca w interfejsie, ktore z niego korzystaja.
const MAX_BYTES = 10 * 1024 * 1024
const MAX_FILES = 5

/**
 * Pomysł klienta na ulepszenie portalu, opcjonalnie ze zrzutami ekranu.
 *
 * multipart/form-data, nie JSON — plik nie da się zakodować w JSON-ie bez
 * base64, a to trzykrotnie napompowałoby limit rozmiaru zapytania za darmo.
 *
 * Wymaga sesji w TYM portalu, bo `slug` decyduje, w imieniu którego projektu
 * pomysł zostanie podpisany. Bez tego sprawdzenia każdy zalogowany klient
 * mógłby wysyłać zgłoszenia podpisane cudzym projektem.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  const slug = form?.get('slug')
  const text = form?.get('text')

  if (
    typeof slug !== 'string' ||
    !slug ||
    typeof text !== 'string' ||
    text.length < IDEA_MIN_LENGTH ||
    text.length > IDEA_MAX_LENGTH
  ) {
    return NextResponse.json(
      { error: `Napisz od ${IDEA_MIN_LENGTH} do ${IDEA_MAX_LENGTH} znaków.` },
      { status: 400 }
    )
  }

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

  // Zalacznik jest dodatkiem, nie warunkiem: za duzy albo nie-obrazkowy plik
  // jest po prostu pomijany, nie wywala calego zgloszenia pomyslu.
  const files = (form?.getAll('files') ?? [])
    .filter((f): f is File => f instanceof File && f.type.startsWith('image/') && f.size <= MAX_BYTES)
    .slice(0, MAX_FILES)

  const outcome = await submitIdea({
    userId,
    portalId: portal.id,
    portalName: portal.name,
    portalSlug: portal.slug,
    authorEmail: session.email,
    authorName: session.name,
    text,
    defaultAssigneeId: portal.defaultAssigneeId,
    files,
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

  return NextResponse.json({ ok: true, attachmentsFailed: outcome.attachmentsFailed })
}
