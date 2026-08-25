import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { requirePortalApi } from '@/lib/apiSession'
import { normalizeActorId } from '@/lib/reporter'
import { parseAvatarDataUri } from '@/lib/profile'
import { getAvatarDataUri } from '@/lib/profileStore'

/**
 * Zdjęcie profilowe jako OBRAZEK, nie jako pole w JSON-ie.
 *
 * Powód jest zapisany przy kolumnie `avatar_url`: trzymamy tam data URI, a data
 * URI w payloadzie listy to dziesiątki kilobajtów przy każdym otwarciu szuflady
 * z komentarzami. Tutaj obrazek idzie raz, a potem odpowiada na niego cache
 * przeglądarki i ETag, więc kolejne wejścia kosztują 304 bez ciała.
 *
 * `Cache-Control: private`, nie `public`: odpowiedź zależy od sesji, więc nie
 * może wylądować we wspólnym cache pośrednika, gdzie dosięgnąłby jej ktoś inny.
 * Krótkie `max-age` przy ETagu wystarcza — zmiana zdjęcia ma być widoczna od
 * razu po odświeżeniu, a nie po godzinie.
 */
const CACHE = 'private, max-age=300, must-revalidate'

/**
 * `userId` jest opcjonalny i domyślnie znaczy „moje zdjęcie". Trasa przyjmuje
 * go, bo awatary mają się kiedyś pokazać przy komentarzach i wtedy potrzebne
 * będą cudze. Dlatego odczyt jest ZAWĘŻONY do portalu z sesji: identyfikator
 * konta z adresu nie może wyciągnąć zdjęcia człowieka z innego projektu.
 */
const userIdSchema = z.string().uuid()

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const gate = await requirePortalApi(params.get('slug'))
  if (!gate.ok) return gate.response

  const zadany = params.get('userId')
  // Bez sluga własnego konta admin nie ma czyjego zdjęcia pokazać: sesja admina
  // nie jest wierszem w `portal_users`.
  const userId = zadany ?? normalizeActorId(gate.session.userId)
  if (!userId || !userIdSchema.safeParse(userId).success) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const dataUri = await getAvatarDataUri(userId, gate.portal.id)
  if (!dataUri) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Wartość z bazy przepuszczamy przez ten sam walidator co przy zapisie.
  // Kolumna mogła zostać wypełniona kiedy indziej (skrypt, panel, ręczny SQL),
  // a ta trasa serwuje treść z NASZEGO origin: nie wolno jej oddać niczego,
  // czego nie sprawdziliśmy tu i teraz.
  const avatar = parseAvatarDataUri(dataUri)
  if (!avatar) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // ETag liczony z treści, więc zmienia się dokładnie wtedy, gdy zmienia się
  // zdjęcie. Data zapisu nie nadawałaby się: kolumny z czasem zmiany nie ma.
  const etag = `"${createHash('sha1').update(avatar.base64).digest('hex')}"`
  const headers = {
    'Content-Type': avatar.contentType,
    'Cache-Control': CACHE,
    ETag: etag,
  }

  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers })
  }

  return new NextResponse(Buffer.from(avatar.base64, 'base64'), { headers })
}
