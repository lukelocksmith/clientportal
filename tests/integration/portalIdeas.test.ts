/**
 * Cooldown i zapis pomyslow klienta na PRAWDZIWEJ bazie.
 *
 * Granice dlugosci i formatowanie tresci sa czyste, wiec sa pilnowane
 * jednostkowo w src/lib/portalIdeas.test.ts. Tutaj jest to, czego bez bazy nie
 * da sie sprawdzic: `ideaSubmittedRecently` liczy okno czasu przez SQL (`gt`),
 * a `submitIdea`/`countIdeas` naprawde wstawiaja i licza wiersze w audit_log.
 *
 * CLICKUP_PORTAL_IDEAS_LIST_ID jest celowo usuwany przed kazdym testem: bez
 * niego submitIdea konczy sie na galezi 'not-configured' i NIE dzwoni do
 * prawdziwego ClickUpa, wiec test zostaje testem bazy, a nie integracja z
 * zewnetrznym API tworzaca prawdziwe zadania.
 *
 *   docker start cp-test-pg && npm run test:integration
 */
import { describe, it, afterAll } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLog } from '@/lib/db/schema'
import {
  submitIdea,
  ideaSubmittedRecently,
  countIdeas,
  IDEA_ACTION,
  IDEA_COOLDOWN_MINUTES,
  IDEA_MIN_LENGTH,
} from '@/lib/portalIdeas'
import { createTestPortal, dropTestPortal, createTestUser, isDbReachable } from './helpers'

const reachable = await isDbReachable()
const portalsToDrop: string[] = []

afterAll(async () => {
  for (const id of portalsToDrop) await dropTestPortal(id)
})

async function freshPortal(prefix: string) {
  const portal = await createTestPortal(prefix)
  portalsToDrop.push(portal.id)
  return portal
}

const TEKST = 'a'.repeat(IDEA_MIN_LENGTH + 5)

describe.skipIf(!reachable)('submitIdea — zapis w audit_log', () => {
  it('zapisuje pomysl jako wiersz audit_log z akcja portal_idea', async () => {
    delete process.env.CLICKUP_PORTAL_IDEAS_LIST_ID
    const portal = await freshPortal('idea-zapis')
    const userId = await createTestUser(portal.id, 'anna@klient.test')

    const result = await submitIdea({
      userId,
      portalId: portal.id,
      portalName: portal.slug,
      portalSlug: portal.slug,
      authorEmail: 'anna@klient.test',
      authorName: 'Anna',
      text: TEKST,
    })

    // Brak konfiguracji listy ClickUp to NASZ problem, nie klienta — dla
    // niego pomysl i tak dotarl (patrz komentarz w portalIdeas.ts).
    assert.deepStrictEqual(result, { ok: false, reason: 'not-configured' })

    const rows = await db.select().from(auditLog).where(eq(auditLog.portalId, portal.id))
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].action, IDEA_ACTION)
    assert.strictEqual(rows[0].userId, userId)
    assert.strictEqual(rows[0].userEmail, 'anna@klient.test')
    assert.strictEqual(JSON.parse(rows[0].meta!).text, TEKST)
  })

  it('sesja admina (userId null) zapisuje sie bez wybuchu na kluczu obcym', async () => {
    delete process.env.CLICKUP_PORTAL_IDEAS_LIST_ID
    const portal = await freshPortal('idea-admin')

    const result = await submitIdea({
      userId: null,
      portalId: portal.id,
      portalName: portal.slug,
      portalSlug: portal.slug,
      authorEmail: 'admin@important.is',
      authorName: 'Admin',
      text: TEKST,
    })

    assert.strictEqual(result.ok, false)
    const rows = await db.select().from(auditLog).where(eq(auditLog.portalId, portal.id))
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].userId, null)
  })
})

describe.skipIf(!reachable)('ideaSubmittedRecently — cooldown', () => {
  it('brak pomyslow — cooldown nie blokuje', async () => {
    const portal = await freshPortal('idea-brak')
    const userId = await createTestUser(portal.id, 'nowy@klient.test')

    assert.strictEqual(await ideaSubmittedRecently(userId), false)
  })

  it('drugie zgloszenie zaraz po pierwszym jest zablokowane', async () => {
    delete process.env.CLICKUP_PORTAL_IDEAS_LIST_ID
    const portal = await freshPortal('idea-cd-blok')
    const userId = await createTestUser(portal.id, 'blok@klient.test')

    await submitIdea({
      userId,
      portalId: portal.id,
      portalName: portal.slug,
      portalSlug: portal.slug,
      authorEmail: 'blok@klient.test',
      authorName: null,
      text: TEKST,
    })

    assert.strictEqual(
      await ideaSubmittedRecently(userId),
      true,
      'zgloszenie sprzed chwili musi blokowac kolejne'
    )
  })

  it('po uplywie okna cooldownu zgloszenie znow jest mozliwe', async () => {
    const portal = await freshPortal('idea-cd-przeszlosc')
    const userId = await createTestUser(portal.id, 'stary@klient.test')

    // Wstawiane wprost do bazy, z data SPRZED okna cooldownu — symuluje
    // pomysl zgloszony dawno, bez czekania w tescie na uplyw czasu.
    const sprzedOkna = new Date(Date.now() - (IDEA_COOLDOWN_MINUTES + 1) * 60 * 1000)
    await db.insert(auditLog).values({
      userId,
      userEmail: 'stary@klient.test',
      portalId: portal.id,
      action: IDEA_ACTION,
      meta: JSON.stringify({ email: 'stary@klient.test', text: TEKST }),
      createdAt: sprzedOkna,
    })

    assert.strictEqual(
      await ideaSubmittedRecently(userId),
      false,
      'pomysl sprzed okna cooldownu nie powinien juz blokowac'
    )
  })

  it('pomysl TUZ PRZED koncem okna cooldownu nadal blokuje', async () => {
    const portal = await freshPortal('idea-cd-brzeg')
    const userId = await createTestUser(portal.id, 'brzeg@klient.test')

    const tuzWOknie = new Date(Date.now() - (IDEA_COOLDOWN_MINUTES * 60 * 1000 - 5_000))
    await db.insert(auditLog).values({
      userId,
      userEmail: 'brzeg@klient.test',
      portalId: portal.id,
      action: IDEA_ACTION,
      meta: JSON.stringify({ email: 'brzeg@klient.test', text: TEKST }),
      createdAt: tuzWOknie,
    })

    assert.strictEqual(await ideaSubmittedRecently(userId), true)
  })

  it('cooldown jednej osoby nie blokuje drugiej', async () => {
    delete process.env.CLICKUP_PORTAL_IDEAS_LIST_ID
    const portal = await freshPortal('idea-cd-dwie-osoby')
    const anna = await createTestUser(portal.id, 'anna2@klient.test')
    const bartek = await createTestUser(portal.id, 'bartek2@klient.test')

    await submitIdea({
      userId: anna,
      portalId: portal.id,
      portalName: portal.slug,
      portalSlug: portal.slug,
      authorEmail: 'anna2@klient.test',
      authorName: null,
      text: TEKST,
    })

    assert.strictEqual(await ideaSubmittedRecently(anna), true, 'Anna zglosila przed chwila')
    assert.strictEqual(await ideaSubmittedRecently(bartek), false, 'cudzy cooldown nie moze dotyczyc Bartka')
  })

  it('cooldown jednego projektu nie blokuje tego samego adresu w drugim', async () => {
    // Ten sam czlowiek prowadzi dwa projekty u klienta — realny przypadek.
    delete process.env.CLICKUP_PORTAL_IDEAS_LIST_ID
    const a = await freshPortal('idea-cd-proj-a')
    const b = await freshPortal('idea-cd-proj-b')
    const email = 'wspolny@klient.test'
    const userWA = await createTestUser(a.id, email)
    const userWB = await createTestUser(b.id, email)

    await submitIdea({
      userId: userWA,
      portalId: a.id,
      portalName: a.slug,
      portalSlug: a.slug,
      authorEmail: email,
      authorName: null,
      text: TEKST,
    })

    assert.strictEqual(await ideaSubmittedRecently(userWA), true)
    assert.strictEqual(
      await ideaSubmittedRecently(userWB),
      false,
      'to jest inne konto (inny user_id), cooldown idzie po userId, nie po adresie'
    )
  })
})

describe.skipIf(!reachable)('countIdeas', () => {
  it('liczy TYLKO pomysly danego portalu, nie wszystkie wiersze audit_log', async () => {
    delete process.env.CLICKUP_PORTAL_IDEAS_LIST_ID
    const portal = await freshPortal('idea-count')
    const inny = await freshPortal('idea-count-inny')
    const userId = await createTestUser(portal.id, 'licz@klient.test')
    const innyUser = await createTestUser(inny.id, 'obcy@klient.test')

    await submitIdea({
      userId,
      portalId: portal.id,
      portalName: portal.slug,
      portalSlug: portal.slug,
      authorEmail: 'licz@klient.test',
      authorName: null,
      text: TEKST,
    })
    // Zdarzenie innego rodzaju w TYM SAMYM portalu — nie powinno wejsc do liczby.
    await db.insert(auditLog).values({
      portalId: portal.id,
      action: 'login',
      meta: null,
    })
    // Pomysl w INNYM portalu — nie powinien wejsc do liczby.
    await submitIdea({
      userId: innyUser,
      portalId: inny.id,
      portalName: inny.slug,
      portalSlug: inny.slug,
      authorEmail: 'obcy@klient.test',
      authorName: null,
      text: TEKST,
    })

    assert.strictEqual(await countIdeas(portal.id), 1)
  })
})
