import { describe, it } from 'vitest'
import assert from 'node:assert'
import { computeCost, getPrice, isFreeModel } from './aiPricing'

/**
 * Cennik modeli AI. Liczby, ktore ogladamy w panelu, oceniajac koszt portalu.
 *
 * NIE ida do faktury dla klienta i sa tak podpisane, ale sluza do decyzji
 * „czy ten czat sie oplaca". Najwazniejsze rozroznienie w tym module: model
 * DARMOWY kosztuje zero i o tym WIEMY (`known: true`), a model NIEZNANY tez
 * liczy sie jako zero, ale o jego cenie nie wiemy NIC (`known: false`).
 * Zlanie tych dwoch przypadkow pokazywaloby zero kosztu przy modelu, ktory
 * realnie kosztuje — i nikt by tego nie zauwazyl.
 *
 *   npx vitest run src/lib/aiPricing.test.ts
 */
describe('isFreeModel', () => {
  it('koncowka :free znaczy darmowy', () => {
    assert.strictEqual(isFreeModel('nvidia/nemotron-3-super-120b-a12b:free'), true)
  })

  it('openrouter/free jest darmowy', () => {
    assert.strictEqual(isFreeModel('openrouter/free'), true)
  })

  it('platny model nie jest darmowy', () => {
    assert.strictEqual(isFreeModel('gemini-2.5-flash'), false)
    // `:free` musi byc na KONCU, nie w srodku nazwy.
    assert.strictEqual(isFreeModel('model:free-tier-czegos'), false)
  })
})

describe('getPrice', () => {
  it('znany model ma cene i jest oznaczony jako znany', () => {
    const { price, known } = getPrice('gemini-2.5-flash')

    assert.strictEqual(known, true)
    assert.ok(price.input > 0 && price.output > 0)
  })

  it('wyjscie jest DROZSZE niz wejscie — inaczej cennik byloby przepisany zle', () => {
    for (const model of ['gemini-2.5-flash', 'claude-haiku-4-5']) {
      const { price } = getPrice(model)
      assert.ok(price.output > price.input, `${model}: wyjscie powinno kosztowac wiecej`)
    }
  })

  it('model darmowy: zero kosztu i WIEMY o tym', () => {
    const { price, known } = getPrice('cos/tam:free')

    assert.strictEqual(known, true)
    assert.deepStrictEqual(price, { input: 0, output: 0 })
  })

  it('model NIEZNANY: zero kosztu, ale NIE wiemy o tym', () => {
    const { price, known } = getPrice('jakis-nowy-model-2027')

    // `known: false` jest calym sensem tego rozroznienia: panel ma pokazac,
    // ze to szacunek bez cennika, a nie ze czat byl darmowy.
    assert.strictEqual(known, false)
    assert.deepStrictEqual(price, { input: 0, output: 0 })
  })
})

describe('computeCost', () => {
  it('liczy koszt z rozbiciem na wejscie i wyjscie', () => {
    // gemini-2.5-flash: 0.30 za milion wejscia, 2.50 za milion wyjscia.
    const koszt = computeCost('gemini-2.5-flash', 1_000_000, 1_000_000)

    assert.strictEqual(Number(koszt.toFixed(4)), 2.8)
  })

  it('typowa rozmowa kosztuje UŁAMEK centa, a nie zero', () => {
    const koszt = computeCost('gemini-2.5-flash', 2_000, 500)

    // To jest powod, dla ktorego format kosztu ma cztery miejsca po przecinku:
    // przy dwoch kazda rozmowa wygladalaby na darmowa.
    assert.ok(koszt > 0, 'koszt jest dodatni')
    assert.ok(koszt < 0.01, 'i jest ulamkiem centa')
  })

  it('zero tokenow to zero kosztu', () => {
    assert.strictEqual(computeCost('gemini-2.5-flash', 0, 0), 0)
  })

  it('nieznany model daje zero, bez wyjatku', () => {
    assert.strictEqual(computeCost('model-ktorego-nie-znamy', 10_000, 5_000), 0)
  })

  it('darmowy model daje zero mimo duzego zuzycia', () => {
    assert.strictEqual(computeCost('cos:free', 1_000_000, 1_000_000), 0)
  })

  it('koszt rosnie liniowo z liczba tokenow', () => {
    const jeden = computeCost('claude-haiku-4-5', 1_000, 1_000)
    const dziesiec = computeCost('claude-haiku-4-5', 10_000, 10_000)

    assert.strictEqual(Number((dziesiec / jeden).toFixed(6)), 10)
  })
})
