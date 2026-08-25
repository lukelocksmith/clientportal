import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { requirePortalApi } from '@/lib/apiSession'
import { readJson } from '@/lib/apiJson'
import { normalizeActorId } from '@/lib/reporter'
import { validatePasswordChange } from '@/lib/profile'
import { getCredentials, savePasswordHash } from '@/lib/profileStore'
// Blokada po nieudanych probach jest WSPOLNA z logowaniem. Formularz zmiany
// hasla jest drugim miejscem, w ktorym da sie zgadywac haslo, a osobny licznik
// znaczylby, ze napastnik wybiera to wejscie, ktore limitu nie ma.
import { verifyUserPassword } from '@/lib/loginAttempts'
import { logEvent, requestOrigin, EVENT_PASSWORD_SET } from '@/lib/portalEvents'
import { sendPasswordChangedNotice } from '@/lib/passwordNotice'

/**
 * Zmiana hasła z profilu.
 *
 * STARE HASŁO JEST WYMAGANE i to jest sens istnienia tej trasy w takiej
 * postaci: przejęta sesja nie może przejąć konta. Bez tego pola ktoś, kto siadł
 * przy niezablokowanym laptopie, ustawia własne hasło i właściciel traci dostęp
 * do portalu, nie tracąc nawet sesji.
 *
 * Konto bierzemy Z SESJI. W ciele nie ma identyfikatora użytkownika i być go
 * nie może — inaczej zalogowany klient zmieniałby hasło komukolwiek.
 */

const schema = z
  .object({
    slug: z.string().min(1).max(50),
    // Bez `min` na hasłach: minimum sprawdza `validatePasswordChange`, żeby
    // klient dostał konkretny komunikat po polsku, a nie surowy błąd schematu.
    current: z.string().max(200),
    next: z.string().max(200),
    confirm: z.string().max(200),
  })
  .strict()

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await readJson(request))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Uzupełnij wszystkie trzy pola.' }, { status: 400 })
  }

  const gate = await requirePortalApi(parsed.data.slug)
  if (!gate.ok) return gate.response

  // Sesja admina nie jest wierszem w `portal_users`, więc nie ma tu hasła do
  // zmiany. Odmawiamy wprost, zamiast szukać konta po `userId: 'admin'`.
  const userId = normalizeActorId(gate.session.userId)
  if (!userId) {
    return NextResponse.json(
      { error: 'Konto administratora nie ma hasła w tym projekcie.' },
      { status: 403 }
    )
  }

  const reguly = validatePasswordChange(parsed.data)
  if (!reguly.ok) return NextResponse.json({ error: reguly.error }, { status: 400 })

  const konto = await getCredentials(userId, gate.portal.id)
  if (!konto) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const wynik = await verifyUserPassword(konto, parsed.data.current)
  if (wynik === 'locked') {
    return NextResponse.json(
      { error: 'Za dużo prób. Spróbuj za kilkanaście minut.' },
      { status: 429 }
    )
  }
  if (wynik === 'bad') {
    return NextResponse.json({ error: 'Obecne hasło jest nieprawidłowe.' }, { status: 401 })
  }

  // Koszt 12, ten sam co przy haśle ustawianym przez admina i z zaproszenia.
  // Niższy koszt tutaj oznaczałby, że hasło zmienione przez klienta jest
  // słabiej chronione niż to, które dostał od nas.
  await savePasswordHash(userId, gate.portal.id, await bcrypt.hash(parsed.data.next, 12))

  const skad = requestOrigin(request.headers)
  await logEvent({
    portalId: gate.portal.id,
    actor: { userId, email: konto.email, name: konto.name },
    action: EVENT_PASSWORD_SET,
    // Rodzaj zdarzenia jest ten sam co przy haśle z linku, rozróżnia je
    // `zrodlo`. Osobna stała nie dawałaby nic ponad to, a historia projektu
    // ma już etykietę „Ustawienie hasła".
    meta: { ...skad, zrodlo: 'profil, zmiana hasla' },
  })

  // Powiadomienie PO fakcie, na adres konta. Zabezpieczenie, nie uprzejmość:
  // bez tego maila przejęcie konta przez przejętą sesję jest ciche. Funkcja
  // nigdy nie rzuca wyjątkiem, więc awaria poczty nie pokaże klientowi
  // „nie udało się" po zmianie, która się udała.
  await sendPasswordChangedNotice({
    to: konto.email,
    recipientName: konto.name,
    portalId: gate.portal.id,
    portalSlug: gate.portal.slug,
  })

  return NextResponse.json({ ok: true })
}
