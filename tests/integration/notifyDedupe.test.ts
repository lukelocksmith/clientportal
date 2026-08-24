/**
 * ZAPORA PRZED PODWOJNYM POWIADOMIENIEM, na prawdziwym Postgresie.
 *
 * Powstalo po incydencie 2026-08-24: Lukasz testowal powiadomienia na zywo i
 * zobaczyl w dzwonku KAZDA pozycje dwa razy. W bazie byly pary wierszy z ta
 * sama trescia i tym samym znacznikiem czasu, wiec zrodlem byl podwojnie
 * dostarczony webhook, a nie blad renderowania.
 *
 * Poprzednia brama (`commentAlreadyNotified`) sprawdzala powtorke zapytaniem
 * SELECT przed zapisem. To ma WYSCIG: dwa rownolegle zadania oba widza „nic tu
 * nie ma" i oba wstawiaja. Do tego dzialala WYLACZNIE dla komentarzy, wiec
 * zmiany statusu nie mialy zadnej ochrony.
 *
 * Ten plik pilnuje obu rzeczy naraz, i to na prawdziwej bazie, bo sedno
 * poprawki jest w unikalnym indeksie — atrapa `db` udowodnilaby tylko, ze
 * napisalismy `onConflictDoNothing`, a nie ze baza faktycznie odrzuca drugi
 * zapis.
 *
 *   docker start clientportal-postgres-1 && npm run test:integration
 */
import { describe, it, beforeAll, afterAll, afterEach } from 'vitest'
import assert from 'node:assert'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notifiedEvents } from '@/lib/db/schema'
import { claimEvent, releaseEvent } from '@/lib/notificationStore'
import { isDbReachable, createTestPortal, dropTestPortal } from './helpers'

const dbUp = await isDbReachable()

describe.skipIf(!dbUp)('claimEvent', () => {
  let portalId: string
  let innyPortalId: string

  beforeAll(async () => {
    const portal = await createTestPortal('dedupe')
    portalId = portal.id
    const inny = await createTestPortal('dedupe-inny')
    innyPortalId = inny.id
  })

  afterAll(async () => {
    if (portalId) await dropTestPortal(portalId)
    if (innyPortalId) await dropTestPortal(innyPortalId)
  })

  afterEach(async () => {
    await db.delete(notifiedEvents).where(eq(notifiedEvents.portalId, portalId))
    await db.delete(notifiedEvents).where(eq(notifiedEvents.portalId, innyPortalId))
  })

  it('pierwsze zajecie klucza przechodzi, drugie NIE', async () => {
    assert.strictEqual(await claimEvent(portalId, 'comment:abc'), true)
    assert.strictEqual(await claimEvent(portalId, 'comment:abc'), false)
  })

  it('WYSCIG: dwa rownolegle zajecia tego samego klucza daja dokladnie JEDNO true', async () => {
    // To jest sedno incydentu. Webhook ClickUpa przyszedl dwa razy w odstepie
    // ulamka sekundy, wiec oba zadania byly w locie JEDNOCZESNIE. Sprawdzenie
    // typu „najpierw SELECT, potem INSERT" przepuscilo oba.
    const wyniki = await Promise.all([
      claimEvent(portalId, 'status:zadanie-1:w trakcie'),
      claimEvent(portalId, 'status:zadanie-1:w trakcie'),
    ])

    assert.strictEqual(wyniki.filter(Boolean).length, 1, 'dokladnie jedno zdarzenie ma przejsc')
  })

  it('WYSCIG na szeroko: piec rownoleglych prob daje jedno true', async () => {
    /**
     * `allSettled`, nie `all`, i to nie jest ostrożnościowa ozdoba.
     *
     * Ten test raz padł w pełnym przebiegu i NIE dało się powiedzieć dlaczego,
     * bo `Promise.all` zamienia awarię połączenia w to samo czerwone, co
     * zerwany niezmiennik. A to dwie zupełnie różne diagnozy: pierwsza znaczy
     * „pula połączeń pod obciążeniem testów" (vitest puszcza pliki równolegle,
     * a `postgres()` domyślnie daje 10 połączeń NA PROCES), druga znaczy
     * „zapora powtórek nie działa i klient dostanie dublety".
     *
     * Dlatego odrzucenia raportujemy OSOBNO i z treścią błędu.
     */
    const wyniki = await Promise.allSettled(
      Array.from({ length: 5 }, () => claimEvent(portalId, 'comment:powtorka'))
    )

    const bledy = wyniki.filter(w => w.status === 'rejected')
    assert.strictEqual(
      bledy.length,
      0,
      `zapytania nie doszly do bazy: ${bledy.map(b => String((b as PromiseRejectedResult).reason)).join(' | ')}`
    )

    const wygrane = wyniki.filter(w => w.status === 'fulfilled' && w.value === true).length
    assert.strictEqual(wygrane, 1, `dokladnie jedno zajecie mialo przejsc, przeszlo ${wygrane}`)
  })

  it('rozne klucze nie blokuja sie wzajemnie', async () => {
    assert.strictEqual(await claimEvent(portalId, 'status:zadanie-1:w trakcie'), true)
    // Ta sama sprawa, ale INNY status: to prawdziwa druga zmiana, ma przejsc.
    assert.strictEqual(await claimEvent(portalId, 'status:zadanie-1:zrobione'), true)
    assert.strictEqual(await claimEvent(portalId, 'comment:zupelnie-inny'), true)
  })

  it('ten sam klucz w INNYM projekcie przechodzi, bo to inne zdarzenie', async () => {
    assert.strictEqual(await claimEvent(portalId, 'comment:abc'), true)
    assert.strictEqual(await claimEvent(innyPortalId, 'comment:abc'), true)
  })
})

describe.skipIf(!dbUp)('releaseEvent', () => {
  let portalId: string

  beforeAll(async () => {
    const portal = await createTestPortal('release')
    portalId = portal.id
  })

  afterAll(async () => {
    if (portalId) await dropTestPortal(portalId)
  })

  afterEach(async () => {
    await db.delete(notifiedEvents).where(eq(notifiedEvents.portalId, portalId))
  })

  it('zwalnia klucz, wiec zdarzenie da sie obsluzyc ponownie', async () => {
    // Po co: gdyby wysylka wywalila sie PO zajeciu klucza, powiadomienie
    // przepadloby na zawsze — ponowne dostarczenie tego samego zdarzenia
    // odbiloby sie od zajetego klucza. Zwolnienie przywraca szanse.
    assert.strictEqual(await claimEvent(portalId, 'comment:x'), true)
    await releaseEvent(portalId, 'comment:x')
    assert.strictEqual(await claimEvent(portalId, 'comment:x'), true)
  })

  it('zwolnienie nieistniejacego klucza nie wybucha', async () => {
    await releaseEvent(portalId, 'klucz-ktorego-nie-ma')
  })

  it('zwalnia TYLKO wskazany klucz', async () => {
    await claimEvent(portalId, 'comment:a')
    await claimEvent(portalId, 'comment:b')

    await releaseEvent(portalId, 'comment:a')

    assert.strictEqual(await claimEvent(portalId, 'comment:a'), true, 'a mial byc zwolniony')
    assert.strictEqual(await claimEvent(portalId, 'comment:b'), false, 'b mial zostac zajety')
  })
})
