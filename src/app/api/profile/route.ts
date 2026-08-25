import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePortalApi } from '@/lib/apiSession'
import { readJson } from '@/lib/apiJson'
import { normalizeActorId } from '@/lib/reporter'
import { MAX_AVATAR_BYTES, MAX_NAME_LENGTH, normalizeName, parseAvatarDataUri } from '@/lib/profile'
import { getProfile, saveProfileFields } from '@/lib/profileStore'

/**
 * Profil klienta: imię i zdjęcie.
 *
 * Wszystko dzieje się na koncie Z SESJI. W ciele żądania NIE MA i nie może być
 * identyfikatora konta: to jedyna strona portalu, na której naturalnie chciałoby
 * się go przyjąć („zapisz profil użytkownika X"), a wtedy każdy zalogowany
 * klient zmienia cudze imię i cudze zdjęcie jednym curl-em.
 *
 * Zdjęcie NIE wychodzi tą trasą jako data URI, tylko jako `hasAvatar`. Treść
 * oddaje `/api/avatar` z nagłówkami cache — patrz komentarz przy kolumnie
 * `avatar_url` w schemacie.
 */

/**
 * Sesja admina przeglądającego cudzy portal ma `userId: 'admin'` i NIE jest
 * wierszem w `portal_users`. Nie ma więc czego edytować: podgląd ma działać,
 * zapis ma odmówić wprost, zamiast trafić w cudzy wiersz albo wywrócić się na
 * `invalid input syntax for type uuid`.
 */
function ownUserId(sessionUserId: string): string | null {
  return normalizeActorId(sessionUserId)
}

const ODMOWA_ADMINA = 'Konto administratora nie ma profilu w tym projekcie.'

export async function GET(request: NextRequest) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response

  const userId = ownUserId(gate.session.userId)
  if (!userId) {
    return NextResponse.json({
      adminPreview: true,
      profile: { email: gate.session.email, name: gate.session.name, hasAvatar: false },
    })
  }

  const profile = await getProfile(userId, gate.portal.id)
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    profile: { email: profile.email, name: profile.name, hasAvatar: profile.hasAvatar },
  })
}

/**
 * `.strict()`, więc nieznane pole kończy się odmową, a nie cichym pominięciem.
 * Przy tej trasie to jest zabezpieczenie, nie pedanteria: żądanie z `userId`
 * ma zostać ODRZUCONE, żeby nikt nie wyciągnął z jego powodzenia wniosku, że
 * pole zadziałało.
 *
 * `null` w `name` i `avatar` znaczy „wyczyść", brak pola znaczy „nie ruszaj".
 */
const patchSchema = z
  .object({
    slug: z.string().min(1).max(50),
    name: z.string().max(MAX_NAME_LENGTH).nullable().optional(),
    // Limit jest też w `parseAvatarDataUri`; tutaj odcina ładunek, zanim
    // zacznie go dotykać cokolwiek poza walidatorem.
    avatar: z.string().max(MAX_AVATAR_BYTES).nullable().optional(),
  })
  .strict()

export async function PATCH(request: NextRequest) {
  const parsed = patchSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nie rozumiem tego żądania.' }, { status: 400 })
  }

  const gate = await requirePortalApi(parsed.data.slug)
  if (!gate.ok) return gate.response

  const userId = ownUserId(gate.session.userId)
  if (!userId) return NextResponse.json({ error: ODMOWA_ADMINA }, { status: 403 })

  const zmiany: { name?: string | null; avatarUrl?: string | null } = {}

  if (parsed.data.name !== undefined) {
    // Puste pole to `null`, nie pusty napis: patrz `normalizeName`.
    zmiany.name = normalizeName(parsed.data.name)
  }

  if (parsed.data.avatar !== undefined) {
    if (parsed.data.avatar === null) {
      zmiany.avatarUrl = null
    } else {
      const avatar = parseAvatarDataUri(parsed.data.avatar)
      if (!avatar) {
        return NextResponse.json(
          { error: 'Nie przyjmujemy tego zdjęcia. Użyj pliku PNG, JPG albo WEBP.' },
          { status: 400 }
        )
      }
      // Zapisujemy ładunek po walidacji, złożony z rozebranych części, a nie
      // napis z żądania: dzięki temu do kolumny nie wejdzie nic spoza tego,
      // co walidator faktycznie sprawdził (np. białe znaki na brzegach).
      zmiany.avatarUrl = `data:${avatar.contentType};base64,${avatar.base64}`
    }
  }

  await saveProfileFields(userId, gate.portal.id, zmiany)

  const profile = await getProfile(userId, gate.portal.id)
  return NextResponse.json({
    ok: true,
    profile: profile
      ? { email: profile.email, name: profile.name, hasAvatar: profile.hasAvatar }
      : null,
  })
}
