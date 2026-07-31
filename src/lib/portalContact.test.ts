/**
 * Sprawdzenie kontaktu opiekuna projektu.
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  resolveContacts,
  isPlausibleEmail,
  normalizePhone,
  phoneHref,
} from '@/lib/portalContact'
import { TEAM_MEMBERS, parseContactMemberIds, serializeContactMemberIds } from '@/lib/team'

describe('portalContact', () => {

  it('email', () => {
    assert.ok(isPlausibleEmail('paulina.a@important.is'))
    assert.ok(isPlausibleEmail(' hi@important.is '))
    for (const bad of [null, undefined, '', '   ', 'bezmalpy', 'a@b', 'a@b.', '@b.pl', 'a b@c.pl', 'a@@b.pl']) {
      assert.strictEqual(isPlausibleEmail(bad as string), false, `powinno odpaść: ${String(bad)}`)
    }
  })

  it('phone', () => {
    assert.strictEqual(normalizePhone('+48 600 123 456'), '+48 600 123 456')
    assert.strictEqual(normalizePhone('600123456'), '600123456')
    assert.strictEqual(normalizePhone('(22) 123-45-67'), null, 'nawias na początku odpada')
    assert.strictEqual(normalizePhone('+48 (22) 123-45-67'), '+48 (22) 123-45-67')

    // Za krótkie, puste i wszystko, co mogłoby wjechać do href.
    for (const bad of [null, undefined, '', '   ', '12345', 'zadzwoń', '+48 abc', "600123456'\"", 'javascript:alert(1)']) {
      assert.strictEqual(normalizePhone(bad as string), null, `powinno odpaść: ${String(bad)}`)
    }

    assert.strictEqual(phoneHref('+48 600 123 456'), 'tel:+48600123456')
    assert.strictEqual(phoneHref('(22) 123-45-67'), 'tel:221234567')
  })

  it('team roster', () => {
    // Identyfikatory sa zapisywane do bazy, wiec musza byc unikalne i stabilne.
    const ids = TEAM_MEMBERS.map(m => m.id)
    assert.strictEqual(new Set(ids).size, ids.length, 'zduplikowany id w TEAM_MEMBERS')
    for (const m of TEAM_MEMBERS) {
      assert.ok(isPlausibleEmail(m.email), `zly e-mail: ${m.id}`)
      assert.ok(m.roleLabel.length > 0, `brak podpisu roli: ${m.id}`)
    }

    assert.deepStrictEqual(parseContactMemberIds('filip,paulina').map(m => m.id), ['filip', 'paulina'])
    assert.deepStrictEqual(parseContactMemberIds('paulina').map(m => m.id), ['paulina'])
    assert.deepStrictEqual(parseContactMemberIds('').map(m => m.id), [], 'pusty ciag to swiadomy brak')
    assert.deepStrictEqual(parseContactMemberIds(null).map(m => m.id), [])

    // Kolejnosc idzie z TEAM_MEMBERS, nie z zapisu, zeby byla ta sama wszedzie.
    assert.deepStrictEqual(
      parseContactMemberIds('paulina,filip').map(m => m.id),
      TEAM_MEMBERS.filter(m => ['filip', 'paulina'].includes(m.id)).map(m => m.id),
      'kolejnosc z rostera, nie z bazy'
    )

    // Nieznany id nie moze wysadzic strony, tylko zostac pominiety.
    assert.deepStrictEqual(parseContactMemberIds('filip,ktos-kogo-nie-ma').map(m => m.id), ['filip'])
    assert.strictEqual(serializeContactMemberIds(['paulina', 'zmyslony']), 'paulina')
  })

  it('resolve contacts', () => {
    // null = projekt nieskonfigurowany => caly zespol.
    const fresh = resolveContacts({})
    assert.strictEqual(fresh.length, TEAM_MEMBERS.length, 'null daje caly zespol')
    assert.ok(fresh.every(c => c.roleLabel !== null), 'czlonkowie zespolu maja podpis roli')

    // Wybor jednej osoby.
    const one = resolveContacts({ contactMemberIds: 'paulina' })
    assert.strictEqual(one.length, 1)
    assert.strictEqual(one[0].email, 'paulina.a@important.is')

    // Kontakt dodatkowy doklada sie NA KONIEC i nie ma podpisu roli.
    const withExtra = resolveContacts({
      contactMemberIds: 'filip',
      contactName: 'Anna z Onyxu',
      contactEmail: 'anna@onyx.pl',
      contactPhone: '+48 600 111 222',
    })
    assert.strictEqual(withExtra.length, 2)
    assert.strictEqual(withExtra[1].name, 'Anna z Onyxu')
    assert.strictEqual(withExtra[1].roleLabel, null)
    assert.strictEqual(withExtra[1].phone, '+48 600 111 222')

    // Niepoprawny e-mail kontaktu dodatkowego => kontakt nie wchodzi.
    const badExtra = resolveContacts({ contactMemberIds: 'filip', contactEmail: 'bezmalpy' })
    assert.strictEqual(badExtra.length, 1, 'kontakt bez poprawnego e-maila jest pomijany')

    // Pusty ciag to swiadome odznaczenie wszystkich. Musi zostac zapas, bo
    // sekcja kontaktu bez ani jednego adresu byla by dla klienta bezuzyteczna.
    const noneSelected = resolveContacts({ contactMemberIds: '' })
    assert.strictEqual(noneSelected.length, 1, 'brak wybranych spada na zapas')
    assert.strictEqual(noneSelected[0].email, 'hi@important.is')

    // Odznaczeni wszyscy, ale jest kontakt dodatkowy => tylko on, bez zapasu.
    const onlyExtra = resolveContacts({ contactMemberIds: '', contactEmail: 'anna@onyx.pl' })
    assert.strictEqual(onlyExtra.length, 1)
    assert.strictEqual(onlyExtra[0].email, 'anna@onyx.pl')

    // Adresy sa unikalne, zeby React nie dostal dwoch tych samych kluczy.
    const all = resolveContacts({})
    assert.strictEqual(new Set(all.map(c => c.email)).size, all.length, 'zduplikowany e-mail w liscie')
  })



})
