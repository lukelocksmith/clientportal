import { describe, it, beforeAll, afterAll } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portalUsers } from '@/lib/db/schema'
import { isDbReachable, createTestPortal, dropTestPortal, createTestUser } from './helpers'
import { listAvatarOwners } from '@/lib/profileStore'
import { buildAvatarIndex, avatarUserIdForSender } from '@/lib/commentAvatars'

/**
 * ZDJĘCIE AUTORA przy komentarzu, na prawdziwym Postgresie.
 *
 * Testy jednostkowe (src/lib/commentAvatars.test.ts) sprawdzają dopasowanie
 * nazwy na gotowej liście kont. Tego, co je poprzedza, nie widzą: czy
 * zapytanie do bazy w ogóle wybiera KONTA ZE ZDJĘCIEM, tego portalu i tylko
 * tego. A to jest jedyne miejsce, w którym może się zerwać cały łańcuch od
 * podpisu „(Łukasz Ślusarski)" do obrazka na ekranie.
 *
 *   DATABASE_URL=... npx vitest run tests/integration/commentAvatars.test.ts
 */

/** Najkrótszy poprawny PNG w data URI: 1x1 piksel. */
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='

const dbUp = await isDbReachable()

describe.skipIf(!dbUp)('zdjecie autora komentarza (integracja)', () => {
  let portalId: string
  let obcyPortalId: string
  let zeZdjeciem: string
  let bezZdjecia: string
  let obcyZeZdjeciem: string

  beforeAll(async () => {
    const portal = await createTestPortal('avatars')
    portalId = portal.id
    const obcy = await createTestPortal('avatars-obcy')
    obcyPortalId = obcy.id

    zeZdjeciem = await createTestUser(portalId, `ze-zdjeciem-${portal.slug}@test.pl`)
    bezZdjecia = await createTestUser(portalId, `bez-zdjecia-${portal.slug}@test.pl`)
    obcyZeZdjeciem = await createTestUser(obcyPortalId, `obcy-${obcy.slug}@test.pl`)

    await db.update(portalUsers)
      .set({ name: 'Łukasz Ślusarski', avatarUrl: PNG_1PX })
      .where(eq(portalUsers.id, zeZdjeciem))
    await db.update(portalUsers)
      .set({ name: 'Anna Kowalska' })
      .where(eq(portalUsers.id, bezZdjecia))
    await db.update(portalUsers)
      .set({ name: 'Łukasz Ślusarski', avatarUrl: PNG_1PX })
      .where(eq(portalUsers.id, obcyZeZdjeciem))
  })

  afterAll(async () => {
    await dropTestPortal(portalId)
    await dropTestPortal(obcyPortalId)
  })

  it('podpis autora trafia w konto ze zdjeciem z TEGO portalu', async () => {
    const index = buildAvatarIndex(await listAvatarOwners(portalId))

    assert.strictEqual(avatarUserIdForSender(index, 'Łukasz Ślusarski'), zeZdjeciem)
  })

  it('konto BEZ zdjecia nie trafia na liste, wiec nie strzelamy w 404', async () => {
    // Kazde konto bez zdjecia na liscie to jeden nieudany obrazek na kazdy
    // komentarz tej osoby.
    const owners = await listAvatarOwners(portalId)

    assert.ok(!owners.some(o => o.id === bezZdjecia), 'konto bez zdjecia nie moze tu byc')
    assert.strictEqual(avatarUserIdForSender(buildAvatarIndex(owners), 'Anna Kowalska'), null)
  })

  it('konto z INNEGO portalu o tej samej nazwie nie podstawia swojej twarzy', async () => {
    // Nazwy sie powtarzaja miedzy projektami. To zapytanie jest jedyna granica
    // miedzy „zdjecie autora" a „zdjecie kogos zupelnie innego".
    const owners = await listAvatarOwners(portalId)

    assert.ok(!owners.some(o => o.id === obcyZeZdjeciem))
    assert.strictEqual(owners.length, 1, `z tego portalu ma byc jedno konto ze zdjeciem, bylo: ${owners.length}`)
  })

  it('zapytanie NIE wyciaga samego zdjecia (dziesiatki kilobajtow na wiersz)', async () => {
    // Data URI w payloadzie listy komentarzy to byl powod, dla ktorego zdjecia
    // ida osobna trasa. Gdyby to zapytanie je zwracalo, wrocilby ten sam koszt.
    const owners = await listAvatarOwners(portalId)

    assert.deepStrictEqual(Object.keys(owners[0]).sort(), ['id', 'name'])
  })

  it('zdjecie usuniete z profilu zdejmuje konto z listy', async () => {
    await db.update(portalUsers).set({ avatarUrl: null }).where(eq(portalUsers.id, zeZdjeciem))
    try {
      const index = buildAvatarIndex(await listAvatarOwners(portalId))
      assert.strictEqual(avatarUserIdForSender(index, 'Łukasz Ślusarski'), null)
    } finally {
      await db.update(portalUsers).set({ avatarUrl: PNG_1PX }).where(eq(portalUsers.id, zeZdjeciem))
    }
  })
})
