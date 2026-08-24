/**
 * Kto dostaje powiadomienie i czym.
 *
 * To jest test zachowania wobec klienta, nie formatowania. Blad w jedna strone
 * oznacza cisze, czyli klient nie wie, ze zespol odpisal na jego zgloszenie,
 * w druga zalew poczty i wylaczone powiadomienia.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  chooseRecipients,
  groupOf,
  modeFor,
  statusKind,
  type NotifyUser,
} from '@/lib/notifications'

const user = (id: string, over: Partial<NotifyUser> = {}): NotifyUser => ({
  id,
  isActive: true,
  notifyImportant: 'instant',
  notifyBoard: 'daily',
  ...over,
})

/** Dorota zglosila zadanie, Marek i Anna sa w tym samym portalu. */
const DOROTA = user('dorota')
const MAREK = user('marek')
const ANNA = user('anna')
const ZESPOL = [DOROTA, MAREK, ANNA]

const byId = (rs: { userId: string }[]) => rs.map(r => r.userId).sort()
/**
 * `null` to poprawny wynik i znaczy „dzwonek tak, mail nie", wiec NIE wolno
 * go tu zlac z brakiem wiersza przez `??`. Ta pomylka najpierw wywalila piec
 * testow naraz, choc implementacja byla dobra.
 */
const mailOf = (rs: { userId: string; mail: string | null }[], id: string) => {
  const found = rs.find(r => r.userId === id)
  return found ? found.mail : 'BRAK WIERSZA'
}

describe('groupOf', () => {
  it('komentarz i alarm to sprawy pilne, statusy to ruch na tablicy', () => {
    // Podzial nie jest kosmetyczny: decyduje, ktorym ustawieniem z profilu
    // rzadzi sie dane zdarzenie.
    assert.strictEqual(groupOf('comment'), 'important')
    assert.strictEqual(groupOf('panic_ack'), 'important')
    assert.strictEqual(groupOf('status'), 'board')
    assert.strictEqual(groupOf('closed'), 'board')
    // Nowe zadanie od agencji to tez ruch na tablicy, nie odpowiedz na sprawe
    // klienta, wiec trafia do grupy mniej pilnej (dodane 2026-08-24).
    assert.strictEqual(groupOf('created'), 'board')
  })
})

describe('modeFor', () => {
  it('czyta ustawienie z wlasciwej grupy', () => {
    const u = user('x', { notifyImportant: 'never', notifyBoard: 'instant' })
    assert.strictEqual(modeFor(u, 'comment'), 'never')
    assert.strictEqual(modeFor(u, 'status'), 'instant')
  })

  it('smiec w kolumnie daje daily, nie instant', () => {
    // Wiersz sprzed migracji albo reczna edycja w bazie. Przy niepewnosci
    // wybieramy cisze: mail wyslany przez pomylke jest nieodwracalny.
    const u = user('x', { notifyImportant: 'natychmiast', notifyBoard: '' })
    assert.strictEqual(modeFor(u, 'comment'), 'daily')
    assert.strictEqual(modeFor(u, 'status'), 'daily')
  })
})

describe('chooseRecipients', () => {
  it('mail idzie do zglaszajacej, reszta ma sam dzwonek', () => {
    const out = chooseRecipients({ users: ZESPOL, kind: 'comment', ownerUserId: 'dorota' })

    // Dzwonek dla wszystkich trojga: wiersz powstaje dla kazdego odbiorcy.
    assert.deepStrictEqual(byId(out), ['anna', 'dorota', 'marek'])
    assert.strictEqual(mailOf(out, 'dorota'), 'instant')
    assert.strictEqual(mailOf(out, 'marek'), null)
    assert.strictEqual(mailOf(out, 'anna'), null)
  })

  it('nikt nie dostaje powiadomienia o wlasnej akcji', () => {
    // Marek przeciagnal zadanie na tablicy. Webhook ClickUpa wroci i bez tego
    // filtra powiadomilby Marka o tym, co Marek przed chwila zrobil.
    const out = chooseRecipients({
      users: ZESPOL,
      kind: 'status',
      actorUserId: 'marek',
      ownerUserId: 'dorota',
    })
    assert.deepStrictEqual(byId(out), ['anna', 'dorota'])
  })

  it('zadanie agencji, bez autora po stronie klienta, idzie mailem do wszystkich', () => {
    // Inaczej ta kategoria nie powiadomilaby nigdy nikogo.
    const out = chooseRecipients({ users: ZESPOL, kind: 'comment', ownerUserId: null })
    assert.strictEqual(mailOf(out, 'dorota'), 'instant')
    assert.strictEqual(mailOf(out, 'marek'), 'instant')
    assert.strictEqual(mailOf(out, 'anna'), 'instant')
  })

  it('nieaktywne konto nie dostaje nic, nawet gdy jest autorem', () => {
    const out = chooseRecipients({
      users: [user('dorota', { isActive: false }), MAREK],
      kind: 'comment',
      ownerUserId: 'dorota',
    })
    assert.deepStrictEqual(byId(out), ['marek'])
    // I to NIE moze rozlac maila na Marka: sprawa ma wlasciciela, tylko
    // akurat nie ma go komu wyslac. Rozlanie zamienialoby wylaczone konto
    // w powiadomienie dla calej firmy.
    assert.strictEqual(mailOf(out, 'marek'), null)
  })

  it('gdy autorka sama wywolala zdarzenie, mail nie rozlewa sie na reszte', () => {
    const out = chooseRecipients({
      users: ZESPOL,
      kind: 'comment',
      actorUserId: 'dorota',
      ownerUserId: 'dorota',
    })
    assert.deepStrictEqual(byId(out), ['anna', 'marek'])
    assert.strictEqual(mailOf(out, 'marek'), null)
    assert.strictEqual(mailOf(out, 'anna'), null)
  })

  it('never wycisza maila, ale dzwonek zostaje', () => {
    // Wylaczenie poczty nie moze znaczyc, ze sprawa znika z portalu.
    const cichy = user('dorota', { notifyImportant: 'never' })
    const out = chooseRecipients({ users: [cichy, MAREK], kind: 'comment', ownerUserId: 'dorota' })
    assert.deepStrictEqual(byId(out), ['dorota', 'marek'])
    assert.strictEqual(mailOf(out, 'dorota'), null)
  })

  it('grupy sa niezalezne: wyciszona tablica nie wycisza odpowiedzi', () => {
    const u = user('dorota', { notifyImportant: 'instant', notifyBoard: 'never' })
    const komentarz = chooseRecipients({ users: [u], kind: 'comment', ownerUserId: 'dorota' })
    const status = chooseRecipients({ users: [u], kind: 'status', ownerUserId: 'dorota' })
    assert.strictEqual(mailOf(komentarz, 'dorota'), 'instant')
    assert.strictEqual(mailOf(status, 'dorota'), null)
  })

  it('daily nie wysyla od razu, tylko czeka na zbiorczy', () => {
    const out = chooseRecipients({ users: [DOROTA], kind: 'status', ownerUserId: 'dorota' })
    assert.strictEqual(mailOf(out, 'dorota'), 'daily')
  })

  it('pusty portal nie wywala sie', () => {
    assert.deepStrictEqual(chooseRecipients({ users: [], kind: 'comment' }), [])
  })
})

describe('statusKind', () => {
  it('zamkniete to osobne zdarzenie, reszta to zwykly ruch', () => {
    // Dla klienta zamkniecie to koniec sprawy, a nie kolejny krok, wiec
    // dostaje inna tresc. Ale jedno powiadomienie, nie dwa.
    assert.strictEqual(statusKind('zamknięte'), 'closed')
    assert.strictEqual(statusKind('  Zamknięte  '), 'closed')
    assert.strictEqual(statusKind('w trakcie'), 'status')
    assert.strictEqual(statusKind('weryfikacja'), 'status')
  })
})
