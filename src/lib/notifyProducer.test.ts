import { describe, it } from 'vitest'
import assert from 'node:assert'
import { dedupeKeyFor, type ProduceInput } from './notifyProducer'

/**
 * Klucz powtorki zdarzenia.
 *
 * Ten klucz musi spelniac naraz dwa sprzeczne warunki i wlasnie dlatego ma
 * wlasny plik testow:
 *
 *   1. TO SAMO zdarzenie dostarczone dwa razy -> ten sam klucz (inaczej
 *      dzwonek dubluje pozycje, co zglosil Lukasz 24.08),
 *   2. PRAWDZIWA druga zmiana na te sama wartosc -> INNY klucz (inaczej
 *      zadanie wracajace do „w trakcie" nigdy juz nie powiadomi).
 *
 * Warunek 2 jest tym, ktory latwo zepsuc, bo objawia sie dopiero po tygodniach
 * i wyglada jak „powiadomienia czasem nie dzialaja".
 *
 *   npx vitest run src/lib/notifyProducer.test.ts
 */
function wejscie(nadpisz: Partial<ProduceInput> = {}): ProduceInput {
  return {
    portalId: 'portal-1',
    event: 'status',
    taskId: 'zad-1',
    taskName: 'Zadanie',
    ...nadpisz,
  }
}

describe('komentarz', () => {
  it('klucz idzie po identyfikatorze komentarza, wiec powtorka daje ten sam', () => {
    const a = dedupeKeyFor(wejscie({ event: 'comment', clickupCommentId: 'k-9' }))
    const b = dedupeKeyFor(wejscie({ event: 'comment', clickupCommentId: 'k-9' }))
    assert.strictEqual(a, b)
  })

  it('inny komentarz to inny klucz', () => {
    const a = dedupeKeyFor(wejscie({ event: 'comment', clickupCommentId: 'k-9' }))
    const b = dedupeKeyFor(wejscie({ event: 'comment', clickupCommentId: 'k-10' }))
    assert.notStrictEqual(a, b)
  })
})

describe('nowe zadanie', () => {
  it('klucz to samo zadanie: powstaje raz w zyciu, wiec blokada moze byc trwala', () => {
    const a = dedupeKeyFor(wejscie({ event: 'created' }))
    const b = dedupeKeyFor(wejscie({ event: 'created' }))
    assert.strictEqual(a, b)
    assert.ok(a.startsWith('created:'), 'retencja rozpoznaje te klucze po prefiksie')
  })
})

describe('zmiana statusu', () => {
  it('POWTORKA: to samo zdarzenie (ten sam czas z ClickUpa) daje ten sam klucz', () => {
    const kiedy = new Date('2026-08-24T20:08:17.224Z')
    const a = dedupeKeyFor(wejscie({ toStatus: 'w trakcie', eventAt: kiedy }))
    const b = dedupeKeyFor(wejscie({ toStatus: 'w trakcie', eventAt: kiedy }))
    assert.strictEqual(a, b)
  })

  it('PRAWDZIWA druga zmiana na TEN SAM status daje INNY klucz', () => {
    // Zadanie wraca do „w trakcie" po tygodniu. Gdyby klucz nie niosl czasu,
    // ta zmiana zostalaby uznana za powtorke i klient nie dowiedzialby sie
    // o niej NIGDY.
    const a = dedupeKeyFor(wejscie({ toStatus: 'w trakcie', eventAt: new Date('2026-08-24T20:08:17Z') }))
    const b = dedupeKeyFor(wejscie({ toStatus: 'w trakcie', eventAt: new Date('2026-08-31T09:00:00Z') }))
    assert.notStrictEqual(a, b)
  })

  it('rozne statusy w tej samej chwili to rozne klucze', () => {
    const kiedy = new Date('2026-08-24T20:08:17Z')
    const a = dedupeKeyFor(wejscie({ toStatus: 'w trakcie', eventAt: kiedy }))
    const b = dedupeKeyFor(wejscie({ toStatus: 'zrobione', eventAt: kiedy }))
    assert.notStrictEqual(a, b)
  })

  it('rozne zadania to rozne klucze', () => {
    const kiedy = new Date('2026-08-24T20:08:17Z')
    const a = dedupeKeyFor(wejscie({ taskId: 'zad-1', toStatus: 'w trakcie', eventAt: kiedy }))
    const b = dedupeKeyFor(wejscie({ taskId: 'zad-2', toStatus: 'w trakcie', eventAt: kiedy }))
    assert.notStrictEqual(a, b)
  })

  it('zamkniecie ma inny klucz niz zwykla zmiana statusu', () => {
    const kiedy = new Date('2026-08-24T20:08:17Z')
    const a = dedupeKeyFor(wejscie({ event: 'status', toStatus: 'zrobione', eventAt: kiedy }))
    const b = dedupeKeyFor(wejscie({ event: 'closed', toStatus: 'zrobione', eventAt: kiedy }))
    assert.notStrictEqual(a, b)
  })

  it('BEZ czasu z ClickUpa klucz NIE jest staly, bo blokowalby zmiane na zawsze', () => {
    // Zapas kubelkowy. Sedno: klucz musi zawierac COKOLWIEK zmiennego w czasie,
    // inaczej pierwsza zmiana na „w trakcie" wyklucza wszystkie nastepne.
    const klucz = dedupeKeyFor(wejscie({ toStatus: 'w trakcie', eventAt: null }))
    assert.ok(/:\d+$/.test(klucz), `klucz zapasowy musi niesc czas, jest: ${klucz}`)
  })
})
