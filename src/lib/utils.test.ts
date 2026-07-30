/**
 * Formatowanie daty pokazywanej klientowi.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { formatDate } from '@/lib/utils'

/** ClickUp podaje daty jako milisekundy w łańcuchu znaków. */
const ms = (iso: string) => String(new Date(iso).getTime())

const TERAZ = new Date('2026-07-30T12:00:00Z')

describe('formatDate', () => {
  it('rok pokazuje sie tylko wtedy, gdy jest inny niz biezacy', () => {
    // Bez roku data z zeszlego roku czytana dzis znaczy cos innego, niz znaczy.
    const stara = formatDate(ms('2025-11-06T13:48:00Z'), TERAZ)
    assert.ok(stara.includes('2025'), `data z innego roku musi miec rok, bylo: ${stara}`)

    // W biezacym roku rok jest szumem, bo i tak wiadomo.
    const biezaca = formatDate(ms('2026-07-06T10:00:00Z'), TERAZ)
    assert.ok(!biezaca.includes('2026'), `data z biezacego roku nie potrzebuje roku, bylo: ${biezaca}`)

    // Rok w przyszlosci tez sie liczy: termin na styczen nastepnego roku bez
    // roku wygladalby jak termin, ktory juz minal.
    const przyszla = formatDate(ms('2027-01-15T10:00:00Z'), TERAZ)
    assert.ok(przyszla.includes('2027'), `data z przyszlego roku musi miec rok, bylo: ${przyszla}`)
  })

  it('dzien i miesiac sa zawsze', () => {
    const out = formatDate(ms('2026-07-06T10:00:00Z'), TERAZ)
    assert.ok(out.includes('6'), `brak dnia: ${out}`)
    assert.ok(/lip/i.test(out), `brak miesiaca: ${out}`)
  })

  it('brak daty i smieci nie wywalaja widoku', () => {
    // Te wartosci trafiaja tu z ClickUpa i z indeksu, wiec pusty ciag jest
    // jedyna bezpieczna odpowiedzia: pole po prostu sie nie pokazuje.
    assert.strictEqual(formatDate(null), '')
    assert.strictEqual(formatDate(undefined), '')
    assert.strictEqual(formatDate(''), '')
    assert.strictEqual(formatDate('nie liczba', TERAZ), '')
  })
})
