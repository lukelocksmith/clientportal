import { describe, it, beforeAll, afterAll, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals, portalUsers, taskWatchers, notifications, mailLog, auditLog } from '@/lib/db/schema'
import { isDbReachable, createTestPortal, dropTestPortal, createTestUser } from './helpers'

/**
 * OBSERWATORZY ZADANIA na PRAWDZIWYM Postgresie, z powiadomieniem na koncu.
 *
 * Testy jednostkowe (src/lib/notifications.test.ts) pilnują REGUŁY „kto dostaje
 * pocztę" i nie widzą bazy. Ten plik sprawdza rzecz, której tamte sprawdzić nie
 * mogą, a która jest całym sensem funkcji: czy dopisanie osoby w szufladzie
 * faktycznie kończy się MAILEM DO NIEJ, przez prawdziwą tabelę, prawdziwy
 * unikalny indeks i prawdziwego producenta powiadomień.
 *
 * Poczta jest podmieniona (`sendMail`), bo test nie ma prawa nic wysłać.
 * Sprawdzamy adresatów, których producent podał do wysyłki.
 *
 *   DATABASE_URL=... npx vitest run tests/integration/taskWatchers.test.ts
 */

/**
 * `sent: true` — to jest pole, po którym producent liczy wysłane maile
 * (`res.sent` w notifyProducer). Mock zwracający `{ ok: true }` dawał
 * `mailed: 0` i wyglądał jak błąd funkcji, a był błędem testu.
 */
const sendMailMock = vi.hoisted(() =>
  vi.fn(async (_opts: { to: string; subject: string }) => ({ sent: true as const, messageId: 'test' })),
)
vi.mock('@/lib/mailer', () => ({
  sendMail: sendMailMock,
  logMail: vi.fn(async () => {}),
}))

const { addWatcher, removeWatcher, listWatchers, watcherUserIds, listCandidates } =
  await import('@/lib/taskWatchers')
const { produceNotifications } = await import('@/lib/notifyProducer')

const dbUp = await isDbReachable()
const TASK = 'fake-task-obserwatorzy'

describe.skipIf(!dbUp)('obserwatorzy zadania (integracja)', () => {
  let portalId: string
  let obcyPortalId: string
  let dorota: string
  let marek: string
  let obcy: string

  beforeAll(async () => {
    const portal = await createTestPortal('watchers')
    portalId = portal.id
    const obcyPortal = await createTestPortal('watchers-obcy')
    obcyPortalId = obcyPortal.id

    dorota = await createTestUser(portalId, `dorota-${portal.slug}@test.pl`)
    marek = await createTestUser(portalId, `marek-${portal.slug}@test.pl`)
    obcy = await createTestUser(obcyPortalId, `obcy-${obcyPortal.slug}@test.pl`)

    // Poczta wychodzi tylko wtedy, gdy admin włączył kanał dla zdarzenia.
    // Bez tego test sprawdzałby ciszę i przechodził niezależnie od kodu.
    await db
      .update(portals)
      .set({ notificationConfig: { comment: { bell: true, mail: true } } })
      .where(eq(portals.id, portalId))

    /**
     * Ślad „to zadanie zgłosiła Dorota".
     *
     * Bez niego zadanie nie ma autora po stronie klienta, a wtedy reguła
     * rozlewa pocztę na WSZYSTKICH (patrz `mailToEveryone` w notifications.ts)
     * i test przechodziłby także wtedy, gdyby obserwatorzy nie działali wcale.
     * Producent czyta autora z dziennika (`reporterUserId`), więc wpis idzie
     * tam, a nie w atrapę.
     */
    await db.insert(auditLog).values({
      portalId,
      userId: dorota,
      userEmail: `dorota-${portal.slug}@test.pl`,
      action: 'task_created',
      resourceId: TASK,
    })
  })

  afterAll(async () => {
    await dropTestPortal(portalId)
    await dropTestPortal(obcyPortalId)
  })

  afterEach(async () => {
    sendMailMock.mockClear()
    await db.delete(taskWatchers).where(eq(taskWatchers.portalId, portalId))
    await db.delete(notifications).where(eq(notifications.portalId, portalId))
    await db.delete(mailLog).where(eq(mailLog.portalId, portalId))
  })

  it('dopisanie i odczyt: obserwator widoczny z nazwą i adresem', async () => {
    assert.strictEqual(await addWatcher({ portalId, clickupTaskId: TASK, userId: marek, addedBy: dorota }), true)

    const lista = await listWatchers(portalId, TASK)
    assert.strictEqual(lista.length, 1)
    assert.strictEqual(lista[0].userId, marek)
    assert.ok(lista[0].email.includes('marek'))
    assert.deepStrictEqual(await watcherUserIds(portalId, TASK), [marek])
  })

  it('dopisanie DWA RAZY nie tworzy duplikatu (unikalny indeks, nie sprawdzenie w kodzie)', async () => {
    await addWatcher({ portalId, clickupTaskId: TASK, userId: marek, addedBy: null })
    await addWatcher({ portalId, clickupTaskId: TASK, userId: marek, addedBy: null })

    const rows = await db
      .select({ id: taskWatchers.id })
      .from(taskWatchers)
      .where(and(eq(taskWatchers.portalId, portalId), eq(taskWatchers.clickupTaskId, TASK)))
    assert.strictEqual(rows.length, 1, 'drugie dopisanie musi być bez skutku')
  })

  it('RÓWNOLEGŁE dopisania (dwa okna, dwa kliknięcia) też dają jeden wiersz', async () => {
    await Promise.all([
      addWatcher({ portalId, clickupTaskId: TASK, userId: marek, addedBy: null }),
      addWatcher({ portalId, clickupTaskId: TASK, userId: marek, addedBy: null }),
      addWatcher({ portalId, clickupTaskId: TASK, userId: marek, addedBy: null }),
    ])

    assert.strictEqual((await watcherUserIds(portalId, TASK)).length, 1)
  })

  it('konta z INNEGO portalu nie da się dopisać', async () => {
    // Identyfikator zadania i konta przychodzą z żądania, więc to jest granica
    // między projektami, nie kosmetyka.
    assert.strictEqual(await addWatcher({ portalId, clickupTaskId: TASK, userId: obcy, addedBy: null }), false)
    assert.deepStrictEqual(await watcherUserIds(portalId, TASK), [])
  })

  it('konta WYŁĄCZONEGO nie da się dopisać', async () => {
    await db.update(portalUsers).set({ isActive: false }).where(eq(portalUsers.id, marek))
    try {
      assert.strictEqual(await addWatcher({ portalId, clickupTaskId: TASK, userId: marek, addedBy: null }), false)
      assert.ok(!(await listCandidates(portalId)).some(c => c.userId === marek), 'nie proponujemy go do dodania')
    } finally {
      await db.update(portalUsers).set({ isActive: true }).where(eq(portalUsers.id, marek))
    }
  })

  it('kont z NASZEJ domeny klient nie widzi na liście do dopisania', async () => {
    // W portalach klientów bywają konta zespołu. Lista kandydatów jedzie
    // prosto do przeglądarki klienta, więc pokazałaby mu nasze adresy przy
    // każdym otwarciu zadania.
    const nasze = await createTestUser(portalId, `zespol-${Date.now()}@important.is`)
    try {
      const kandydaci = await listCandidates(portalId)
      assert.ok(!kandydaci.some(k => k.userId === nasze), 'konto z naszej domeny nie moze byc na liscie')
      assert.ok(kandydaci.some(k => k.userId === marek), 'konta klienta zostaja')
    } finally {
      await db.delete(portalUsers).where(eq(portalUsers.id, nasze))
    }
  })

  it('zdjęcie obserwatora działa, a powtórzone zdjęcie nie jest błędem', async () => {
    await addWatcher({ portalId, clickupTaskId: TASK, userId: marek, addedBy: null })
    await removeWatcher(portalId, TASK, marek)
    await removeWatcher(portalId, TASK, marek)

    assert.deepStrictEqual(await watcherUserIds(portalId, TASK), [])
  })

  it('usunięcie konta zabiera ze sobą obserwowanie (kaskada), nie zostawia sieroty', async () => {
    const tymczasowy = await createTestUser(portalId, `znika-${Date.now()}@test.pl`)
    await addWatcher({ portalId, clickupTaskId: TASK, userId: tymczasowy, addedBy: null })

    await db.delete(portalUsers).where(eq(portalUsers.id, tymczasowy))

    assert.deepStrictEqual(await watcherUserIds(portalId, TASK), [])
  })

  it('CAŁY ŁAŃCUCH: obserwator dostaje maila o komentarzu, choć zadania nie zgłaszał', async () => {
    // To jest test tej funkcji. Przed zmianą poczta szła wyłącznie do autora
    // zgłoszenia, a autora tego zadania w ogóle nie ma (nikt go nie zgłaszał
    // z portalu), więc bez obserwatora nie powinno pójść nic imiennie.
    await addWatcher({ portalId, clickupTaskId: TASK, userId: marek, addedBy: dorota })

    const wynik = await produceNotifications({
      portalId,
      taskId: TASK,
      taskName: 'Zadanie testowe',
      event: 'comment',
      excerpt: 'Odpisaliśmy',
      clickupCommentId: `test-watcher-${Date.now()}`,
    })

    assert.ok(wynik.mailed > 0, `poczta nie poszła do nikogo: ${JSON.stringify(wynik)}`)
    const adresaci = sendMailMock.mock.calls.map(c => c[0].to)
    assert.ok(
      adresaci.some(a => a.includes('marek')),
      `obserwator nie dostał maila, adresaci: ${JSON.stringify(adresaci)}`,
    )
  })

  it('bez obserwatora ta sama sytuacja NIE wysyła maila do Marka', async () => {
    // Para do testu wyżej: dowodzi, że to obserwowanie zrobiło różnicę, a nie
    // jakakolwiek inna reguła po drodze.
    const wynik = await produceNotifications({
      portalId,
      taskId: TASK,
      taskName: 'Zadanie testowe',
      event: 'comment',
      excerpt: 'Odpisaliśmy',
      clickupCommentId: `test-bez-watchera-${Date.now()}`,
    })

    const adresaci = sendMailMock.mock.calls.map(c => c[0].to)
    assert.ok(!adresaci.some(a => a.includes('marek')), `Marek dostał maila bez obserwowania: ${JSON.stringify(adresaci)}, wynik: ${JSON.stringify(wynik)}`)
  })
})
