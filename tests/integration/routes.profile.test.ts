import { describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLog, portalUsers } from '@/lib/db/schema'
import {
  isDbReachable,
  createTestPortal,
  dropTestPortal,
  createTestUserWithPassword,
} from './helpers'

/**
 * Profil klienta na prawdziwej bazie: imie, haslo, zdjecie.
 *
 * Trzy rzeczy, przy ktorych blad jest kosztowny i ktorych nie zlapie zaden test
 * jednostkowy, bo siedza w zapytaniu i w sesji, a nie w funkcji:
 *
 *   1. WSZYSTKO dzieje sie na koncie Z SESJI. Identyfikator z ciala zadania nie
 *      moze zmienic ani imienia, ani hasla, ani zdjecia cudzego konta.
 *   2. Zmiana hasla WYMAGA starego hasla. Przejeta sesja nie moze przejac konta.
 *   3. Zdjecie nie wychodzi data URI w odpowiedziach, tylko osobna trasa z
 *      naglowkami cache. Kolumna `avatar_url` ma komentarz mowiacy to wprost.
 *
 * Podstawiona jest wylacznie poczta. Postgres, sesje, ciasteczka i bcrypt sa
 * prawdziwe: haslo zapisane to nie to samo co haslo dzialajace, wiec nowe haslo
 * sprawdzamy LOGOWANIEM przez prawdziwa trase logowania.
 *
 *   docker start clientportal-postgres-1 && npm run test:integration -- routes.profile
 */
const { cookieJar, mailer } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  mailer: { sendMail: vi.fn() },
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value) },
    delete: (name: string) => { cookieJar.delete(name) },
  })),
}))
vi.mock('@/lib/mailer', () => mailer)

import { NextRequest } from 'next/server'
import { createSession, setSessionCookie } from '@/lib/auth'
import { MAX_AVATAR_BYTES } from '@/lib/profile'
import { EVENT_PASSWORD_SET } from '@/lib/portalEvents'
import { GET as profileGET, PATCH as profilePATCH } from '@/app/api/profile/route'
import { POST as passwordPOST } from '@/app/api/profile/password/route'
import { GET as avatarGET } from '@/app/api/avatar/route'
import { POST as loginPOST } from '@/app/api/auth/login/route'

const dbUp = await isDbReachable()

const HASLO_A = 'stare-haslo-klienta'

/** Maly, poprawny data URI. Tresc nie musi byc obrazkiem: trasa go nie dekoduje jako grafiki. */
const AWATAR = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAAfQ//8='

const jsonReq = (url: string, body: unknown, method = 'POST') =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } as ConstructorParameters<typeof NextRequest>[1])

describe.skipIf(!dbUp)('profil klienta na prawdziwej bazie', () => {
  let portalA: { id: string; slug: string }
  let portalB: { id: string; slug: string }
  let userA: string
  let userB: string
  let emailA: string

  beforeAll(async () => {
    portalA = await createTestPortal('prof-a')
    portalB = await createTestPortal('prof-b')
    emailA = `user-${portalA.slug}@example.com`
    userA = await createTestUserWithPassword({
      portalId: portalA.id,
      email: emailA,
      password: HASLO_A,
      name: 'Klient A',
    })
    userB = await createTestUserWithPassword({
      portalId: portalB.id,
      email: `user-${portalB.slug}@example.com`,
      password: 'haslo-klienta-b',
      name: 'Klient B',
    })
  })

  afterAll(async () => {
    if (portalA) await dropTestPortal(portalA.id)
    if (portalB) await dropTestPortal(portalB.id)
  })

  beforeEach(async () => {
    cookieJar.clear()
    vi.clearAllMocks()
    mailer.sendMail.mockResolvedValue({ ok: true })
    // Kazdy test zaczyna od konta w znanym stanie: haslo, imie, brak zdjecia
    // i wyzerowany licznik prob. Bez tego test blokady zablokowalby konto
    // nastepnym testom, a porazka wygladalaby jak zle dzialajaca trasa.
    await db
      .update(portalUsers)
      .set({ name: 'Klient A', avatarUrl: null, failedAttempts: 0, lockedUntil: null })
      .where(eq(portalUsers.id, userA))
  })

  async function zalogujJako(userId: string): Promise<void> {
    await setSessionCookie(await createSession(userId, '127.0.0.1', 'vitest'))
  }

  async function wierszA() {
    const [row] = await db.select().from(portalUsers).where(eq(portalUsers.id, userA)).limit(1)
    return row
  }

  describe('GET /api/profile', () => {
    it('oddaje WLASNE dane konta z sesji', async () => {
      await zalogujJako(userA)

      const res = await profileGET(new NextRequest(`http://localhost/api/profile?slug=${portalA.slug}`))
      const body = await res.json()

      assert.strictEqual(res.status, 200)
      assert.strictEqual(body.profile.email, emailA)
      assert.strictEqual(body.profile.name, 'Klient A')
      assert.strictEqual(body.profile.hasAvatar, false)
    })

    it('NIE oddaje data URI zdjecia w ciele odpowiedzi, tylko znacznik', async () => {
      // Kolumna `avatar_url` ma przy sobie zakaz wstawiania data URI w payloady:
      // to dziesiatki kilobajtow przy kazdym otwarciu. Profil jest pierwszym
      // miejscem, w ktorym latwo ten zakaz zlamac, bo tu zdjecie jest tematem.
      await zalogujJako(userA)
      await profilePATCH(jsonReq('/api/profile', { slug: portalA.slug, avatar: AWATAR }, 'PATCH'))

      const res = await profileGET(new NextRequest(`http://localhost/api/profile?slug=${portalA.slug}`))
      const surowe = JSON.stringify(await res.json())

      assert.strictEqual(surowe.includes('data:image'), false, 'data URI wycieklo do odpowiedzi')
      assert.strictEqual(surowe.includes('"hasAvatar":true'), true)
    })

    it('bez sesji -> 401, bez sluga -> 400', async () => {
      assert.strictEqual(
        (await profileGET(new NextRequest(`http://localhost/api/profile?slug=${portalA.slug}`))).status,
        401
      )
      await zalogujJako(userA)
      assert.strictEqual(
        (await profileGET(new NextRequest('http://localhost/api/profile'))).status,
        400
      )
    })
  })

  describe('PATCH /api/profile (imie i zdjecie)', () => {
    it('zapisuje imie i zbija w nim znaki nowej linii', async () => {
      await zalogujJako(userA)

      const res = await profilePATCH(
        jsonReq('/api/profile', { slug: portalA.slug, name: '  Anna\nKowalska  ' }, 'PATCH')
      )

      assert.strictEqual(res.status, 200)
      // Sprawdzamy BAZE, nie odpowiedz: odpowiedz moze zwrocic to, co dostala,
      // i wygladac poprawnie przy zerowym zapisie.
      assert.strictEqual((await wierszA()).name, 'Anna Kowalska')
    })

    it('puste imie kasuje wartosc, zamiast zapisywac pusty napis', async () => {
      await zalogujJako(userA)

      await profilePATCH(jsonReq('/api/profile', { slug: portalA.slug, name: '   ' }, 'PATCH'))

      assert.strictEqual((await wierszA()).name, null)
    })

    it('zapisuje zdjecie i pozwala je usunac', async () => {
      await zalogujJako(userA)

      await profilePATCH(jsonReq('/api/profile', { slug: portalA.slug, avatar: AWATAR }, 'PATCH'))
      assert.strictEqual((await wierszA()).avatarUrl, AWATAR)

      await profilePATCH(jsonReq('/api/profile', { slug: portalA.slug, avatar: null }, 'PATCH'))
      assert.strictEqual((await wierszA()).avatarUrl, null)
    })

    it('ODRZUCA zdjecie ponad limit i NIC nie zapisuje', async () => {
      // Skalowanie robi przegladarka, ale to samo zadanie da sie wyslac curl-em.
      await zalogujJako(userA)
      const zaDuze = `data:image/webp;base64,${'A'.repeat(MAX_AVATAR_BYTES)}`

      const res = await profilePATCH(jsonReq('/api/profile', { slug: portalA.slug, avatar: zaDuze }, 'PATCH'))

      assert.strictEqual(res.status, 400)
      assert.strictEqual((await wierszA()).avatarUrl, null)
    })

    it('ODRZUCA SVG, ktore moze niesc skrypt', async () => {
      await zalogujJako(userA)
      const svg = 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg=='

      const res = await profilePATCH(jsonReq('/api/profile', { slug: portalA.slug, avatar: svg }, 'PATCH'))

      assert.strictEqual(res.status, 400)
      assert.strictEqual((await wierszA()).avatarUrl, null)
    })

    it('WYCIEK: identyfikator konta z ciala zadania nie zmienia cudzego profilu', async () => {
      // Cala reszta portalu bierze tozsamosc z sesji. Profil jest pierwsza
      // strona, na ktorej naturalnie chcialoby sie przyjac `userId` z formularza.
      await zalogujJako(userA)

      const res = await profilePATCH(
        jsonReq('/api/profile', { slug: portalA.slug, name: 'Przejete', userId: userB }, 'PATCH')
      )

      const [b] = await db.select().from(portalUsers).where(eq(portalUsers.id, userB)).limit(1)
      assert.strictEqual(b.name, 'Klient B', 'konto z INNEGO portalu zostalo zmienione')
      assert.strictEqual(res.status, 400, 'nieznane pole w ciele ma byc odrzucone, nie zignorowane po cichu')
    })

    it('bez sesji nie zapisuje niczego', async () => {
      const res = await profilePATCH(jsonReq('/api/profile', { slug: portalA.slug, name: 'Nikt' }, 'PATCH'))

      assert.strictEqual(res.status, 401)
      assert.strictEqual((await wierszA()).name, 'Klient A')
    })
  })

  describe('POST /api/profile/password', () => {
    const NOWE = 'nowe-haslo-2026'

    it('zmienia haslo, ktorym DA SIE sie zalogowac, i wysyla powiadomienie', async () => {
      await zalogujJako(userA)

      const res = await passwordPOST(
        jsonReq('/api/profile/password', {
          slug: portalA.slug,
          current: HASLO_A,
          next: NOWE,
          confirm: NOWE,
        })
      )
      assert.strictEqual(res.status, 200)

      // Haslo zapisane to nie to samo co haslo dzialajace: hash moze wygladac
      // poprawnie i nigdy nie pasowac. Sprawdzamy prawdziwa trasa logowania.
      cookieJar.clear()
      const logowanie = await loginPOST(
        jsonReq('/api/auth/login', { slug: portalA.slug, email: emailA, password: NOWE })
      )
      assert.strictEqual(logowanie.status, 200, 'nowym haslem nie da sie zalogowac')

      // Powiadomienie mailem jest zabezpieczeniem, nie uprzejmoscia: bez niego
      // przejecie konta jest ciche.
      assert.strictEqual(mailer.sendMail.mock.calls.length, 1)
      assert.strictEqual(mailer.sendMail.mock.calls[0][0].to, emailA)

      // Sprzatanie: przywracamy haslo startowe, zeby kolejne testy w tym pliku
      // nie zalezaly od kolejnosci wykonania.
      cookieJar.clear()
      await zalogujJako(userA)
      await passwordPOST(
        jsonReq('/api/profile/password', {
          slug: portalA.slug,
          current: NOWE,
          next: HASLO_A,
          confirm: HASLO_A,
        })
      )
    })

    it('zapisuje zdarzenie w historii projektu', async () => {
      await zalogujJako(userA)
      const przed = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.portalId, portalA.id))

      await passwordPOST(
        jsonReq('/api/profile/password', {
          slug: portalA.slug,
          current: HASLO_A,
          next: 'inne-haslo-2026',
          confirm: 'inne-haslo-2026',
        })
      )

      const po = await db
        .select({ action: auditLog.action, meta: auditLog.meta })
        .from(auditLog)
        .where(eq(auditLog.portalId, portalA.id))

      assert.strictEqual(po.length, przed.length + 1)
      const wpis = po[po.length - 1]
      assert.strictEqual(wpis.action, EVENT_PASSWORD_SET)
      assert.match(String(wpis.meta), /profil/)

      cookieJar.clear()
      await zalogujJako(userA)
      await passwordPOST(
        jsonReq('/api/profile/password', {
          slug: portalA.slug,
          current: 'inne-haslo-2026',
          next: HASLO_A,
          confirm: HASLO_A,
        })
      )
    })

    it('ZLE stare haslo nie zmienia niczego i nie wysyla maila', async () => {
      await zalogujJako(userA)
      const hashPrzed = (await wierszA()).passwordHash

      const res = await passwordPOST(
        jsonReq('/api/profile/password', {
          slug: portalA.slug,
          current: 'to-nie-jest-moje-haslo',
          next: NOWE,
          confirm: NOWE,
        })
      )

      assert.strictEqual(res.status, 401)
      assert.strictEqual((await wierszA()).passwordHash, hashPrzed)
      assert.strictEqual(mailer.sendMail.mock.calls.length, 0)
    })

    it('powtarzane proby BLOKUJA konto, tak samo jak przy logowaniu', async () => {
      // Formularz zmiany hasla jest drugim miejscem, w ktorym da sie zgadywac
      // haslo. Bez wspolnego licznika napastnik wybralby to bez limitu.
      await zalogujJako(userA)

      let ostatni = 0
      for (let i = 0; i < 6; i++) {
        const res = await passwordPOST(
          jsonReq('/api/profile/password', {
            slug: portalA.slug,
            current: `zle-haslo-${i}`,
            next: NOWE,
            confirm: NOWE,
          })
        )
        ostatni = res.status
      }

      assert.strictEqual(ostatni, 429, 'po serii prob konto powinno byc zablokowane')
      assert.notStrictEqual((await wierszA()).lockedUntil, null)
    })

    it('niezgodne powtorzenie i za krotkie haslo -> 400, bez dotykania konta', async () => {
      await zalogujJako(userA)
      const hashPrzed = (await wierszA()).passwordHash

      const niezgodne = await passwordPOST(
        jsonReq('/api/profile/password', {
          slug: portalA.slug, current: HASLO_A, next: NOWE, confirm: 'cos-innego-2026',
        })
      )
      const krotkie = await passwordPOST(
        jsonReq('/api/profile/password', {
          slug: portalA.slug, current: HASLO_A, next: 'krotkie', confirm: 'krotkie',
        })
      )

      assert.strictEqual(niezgodne.status, 400)
      assert.strictEqual(krotkie.status, 400)
      assert.strictEqual((await wierszA()).passwordHash, hashPrzed)
    })

    it('bez sesji -> 401', async () => {
      const res = await passwordPOST(
        jsonReq('/api/profile/password', {
          slug: portalA.slug, current: HASLO_A, next: NOWE, confirm: NOWE,
        })
      )
      assert.strictEqual(res.status, 401)
    })
  })

  describe('GET /api/avatar', () => {
    it('oddaje obrazek z ETagiem i cachem przegladarki', async () => {
      await zalogujJako(userA)
      await profilePATCH(jsonReq('/api/profile', { slug: portalA.slug, avatar: AWATAR }, 'PATCH'))

      const res = await avatarGET(new NextRequest(`http://localhost/api/avatar?slug=${portalA.slug}`))

      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers.get('content-type'), 'image/webp')
      assert.ok(res.headers.get('etag'), 'bez ETaga przegladarka pobiera obrazek za kazdym razem')
      // `private`, nie `public`: odpowiedz zalezy od sesji, wiec nie moze
      // wyladowac we wspolnym cache posrednika.
      assert.match(res.headers.get('cache-control') ?? '', /private/)
    })

    it('powtorne pobranie z ETagiem konczy sie 304, bez ciala', async () => {
      await zalogujJako(userA)
      await profilePATCH(jsonReq('/api/profile', { slug: portalA.slug, avatar: AWATAR }, 'PATCH'))

      const pierwsze = await avatarGET(new NextRequest(`http://localhost/api/avatar?slug=${portalA.slug}`))
      const etag = pierwsze.headers.get('etag')!

      const drugie = await avatarGET(
        new NextRequest(`http://localhost/api/avatar?slug=${portalA.slug}`, {
          headers: { 'If-None-Match': etag },
        } as ConstructorParameters<typeof NextRequest>[1])
      )

      assert.strictEqual(drugie.status, 304)
    })

    it('brak zdjecia -> 404, a nie pusty obrazek', async () => {
      await zalogujJako(userA)

      const res = await avatarGET(new NextRequest(`http://localhost/api/avatar?slug=${portalA.slug}`))

      assert.strictEqual(res.status, 404)
    })

    it('WYCIEK: konto z INNEGO portalu nie odda zdjecia', async () => {
      // Trasa przyjmuje `userId`, bo zdjecie ma sie kiedys pokazac przy
      // komentarzach. Zakres jest wiec granica miedzy klientami, nie wygoda.
      await zalogujJako(userB)
      await profilePATCH(jsonReq('/api/profile', { slug: portalB.slug, avatar: AWATAR }, 'PATCH'))

      cookieJar.clear()
      await zalogujJako(userA)
      const res = await avatarGET(
        new NextRequest(`http://localhost/api/avatar?slug=${portalA.slug}&userId=${userB}`)
      )

      assert.strictEqual(res.status, 404)
    })

    it('bez sesji -> 401', async () => {
      const res = await avatarGET(new NextRequest(`http://localhost/api/avatar?slug=${portalA.slug}`))
      assert.strictEqual(res.status, 401)
    })
  })

  describe('sesja admina', () => {
    const adminCookie = () =>
      createHmac('sha256', process.env.ADMIN_SECRET!).update('admin-session').digest('hex')

    it.skipIf(!process.env.ADMIN_SECRET)(
      'admin oglada profil, ale nie ma czego zapisac',
      async () => {
        // Sesja admina ma `userId: "admin"` i NIE jest wierszem w portal_users,
        // wiec kazdy zapis skonczylby sie bledem uuid albo, gorzej, trafil
        // w cudzy wiersz. Podglad ma dzialac, zapis ma odmowic wprost.
        cookieJar.set('admin_session', adminCookie())

        const podglad = await profileGET(new NextRequest(`http://localhost/api/profile?slug=${portalA.slug}`))
        const zapis = await profilePATCH(
          jsonReq('/api/profile', { slug: portalA.slug, name: 'Admin sobie zmienia' }, 'PATCH')
        )
        const haslo = await passwordPOST(
          jsonReq('/api/profile/password', {
            slug: portalA.slug, current: 'x'.repeat(12), next: 'y'.repeat(12), confirm: 'y'.repeat(12),
          })
        )

        assert.strictEqual(podglad.status, 200)
        assert.strictEqual((await podglad.json()).adminPreview, true)
        assert.strictEqual(zapis.status, 403)
        assert.strictEqual(haslo.status, 403)
        // Konto klienta nie moglo przy tym ucierpiec.
        assert.strictEqual((await wierszA()).name, 'Klient A')
      }
    )
  })
})
