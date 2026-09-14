import { describe, it, beforeAll, beforeEach, vi } from 'vitest'
import assert from 'node:assert'
import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { appErrors } from '@/lib/db/schema'
import { isDbReachable } from './helpers'

/**
 * BŁĘDY SERWERA: zapis do bazy i alarm do zespołu.
 *
 * Powstało 14.09. Do tego dnia wyjątek w trasie klienta kończył się kodem 500
 * u niego i wpisem w logu kontenera, czyli nigdzie. Ten sam układ, który przy
 * zgubionym zgłoszeniu Onyxa kosztował tydzień.
 *
 *   docker start cp-test-pg2 && npm run test:integration
 */
const { ops } = vi.hoisted(() => ({ ops: { sendOpsAlert: vi.fn(async (_t: string) => {}) } }))
vi.mock('@/lib/cronRuns', async () => ({ ...(await vi.importActual<object>('@/lib/cronRuns')), ...ops }))

import { zapiszBladSerwera, bledyZDoby, sciezkaBezZapytania, kluczBledu } from '@/lib/appErrors'
import { zapomnijDlawienie } from '@/lib/alertThrottle'

const dbUp = await isDbReachable()

describe.skipIf(!dbUp)('bledy serwera na prawdziwej bazie', () => {
  beforeAll(async () => {
    await db.delete(appErrors)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    zapomnijDlawienie()
  })

  async function ostatni() {
    const [w] = await db.select().from(appErrors).orderBy(desc(appErrors.createdAt)).limit(1)
    return w
  }

  it('zapisuje blad z metoda, sciezka i trescia', async () => {
    const wynik = await zapiszBladSerwera(new Error('ClickUp odmowil: 502'), {
      path: '/api/clickup/tasks',
      method: 'GET',
      routeType: 'route',
    })

    assert.strictEqual(wynik.zapisane, true)
    const w = await ostatni()
    assert.strictEqual(w.path, '/api/clickup/tasks')
    assert.strictEqual(w.method, 'GET')
    assert.strictEqual(w.routeType, 'route')
    assert.strictEqual(w.message, 'ClickUp odmowil: 502')
    assert.ok(w.stack, 'stos zapisany, bez niego blad jest nie do znalezienia')
  })

  it('zapisuje sciezke BEZ parametrow zapytania', async () => {
    await zapiszBladSerwera(new Error('cokolwiek'), {
      path: '/api/siteping/onyx?token=sekret-klienta&id=42',
      method: 'POST',
    })

    // Parametry niosa tokeny i identyfikatory spraw klienta. Rejestr awarii
    // nie jest miejscem, w ktorym maja lezec.
    const w = await ostatni()
    assert.strictEqual(w.path, '/api/siteping/onyx')
    assert.ok(!JSON.stringify(w).includes('sekret-klienta'), 'token nie wyciekl do rejestru')
  })

  it('pierwszy blad budzi zespol', async () => {
    await zapiszBladSerwera(new Error('baza nie odpowiada'), { path: '/api/notifications', method: 'GET' })

    assert.strictEqual(ops.sendOpsAlert.mock.calls.length, 1)
    const tresc = String(ops.sendOpsAlert.mock.calls[0]?.[0])
    assert.ok(tresc.includes('/api/notifications'), `alarm mowi, gdzie: ${tresc}`)
    assert.ok(tresc.includes('baza nie odpowiada'), 'alarm mowi, co sie stalo')
  })

  it('powtorka tego samego bledu NIE budzi zespolu drugi raz', async () => {
    const blad = () => Object.assign(new Error('to samo'), { digest: 'abc123' })
    await zapiszBladSerwera(blad(), { path: '/api/x', method: 'GET' })
    for (let i = 0; i < 9; i++) await zapiszBladSerwera(blad(), { path: '/api/x', method: 'GET' })

    // Dziesiec bledow, jeden alarm. Kanal alarmow ma zostac czytelny —
    // 13.09 moja wlasna seria zamienila go w szum.
    assert.strictEqual(ops.sendOpsAlert.mock.calls.length, 1, 'dokladnie jeden alarm na dziesiec bledow')
    const wiersze = await db.select().from(appErrors).orderBy(desc(appErrors.createdAt)).limit(10)
    const zaalarmowane = wiersze.filter(w => w.alerted).length
    assert.strictEqual(zaalarmowane, 1, 'kolumna `alerted` mowi, ktore wystapienie poszlo dalej')
    assert.strictEqual(wiersze.length, 10, 'ZAPISANE sa wszystkie, tlumimy alarm, nie rejestr')
  })

  it('rozne bledy nie zaglaszaja sie nawzajem', async () => {
    await zapiszBladSerwera(new Error('pierwszy'), { path: '/api/a', method: 'GET' })
    await zapiszBladSerwera(new Error('drugi'), { path: '/api/b', method: 'POST' })

    assert.strictEqual(ops.sendOpsAlert.mock.calls.length, 2)
  })

  it('liczy bledy z ostatniej doby', async () => {
    await db.delete(appErrors)
    await zapiszBladSerwera(new Error('jeden'), { path: '/api/a', method: 'GET' })
    await zapiszBladSerwera(new Error('dwa'), { path: '/api/b', method: 'GET' })

    assert.strictEqual(await bledyZDoby(), 2)
  })
})

describe('czyste reguly', () => {
  it('sciezkaBezZapytania ucina parametry', () => {
    assert.strictEqual(sciezkaBezZapytania('/api/x?a=1&b=2'), '/api/x')
    assert.strictEqual(sciezkaBezZapytania('/api/x'), '/api/x')
  })

  it('klucz dlawienia grupuje po skrocie, gdy Next go dal', () => {
    const a = kluczBledu({ path: '/api/x', method: 'GET', digest: 'd1' }, 'komunikat')
    const b = kluczBledu({ path: '/api/inna', method: 'POST', digest: 'd1' }, 'inny komunikat')
    assert.strictEqual(a, b, 'ten sam wyjatek to jeden problem, niezaleznie od trasy')
  })

  it('bez skrotu klucz rozroznia trasy', () => {
    const a = kluczBledu({ path: '/api/x', method: 'GET' }, 'komunikat')
    const b = kluczBledu({ path: '/api/y', method: 'GET' }, 'komunikat')
    assert.notStrictEqual(a, b)
  })
})
