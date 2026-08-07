import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  TEAM_MEMBERS,
  DEFAULT_CONTACT_MEMBER_IDS,
  findTeamMember,
  parseContactMemberIds,
  serializeContactMemberIds,
} from './team'

/**
 * Zespol jako kontakt na Dashboardzie klienta.
 *
 * `id` jest zapisywane do `portals.contact_member_ids`, wiec te funkcje sa
 * granica miedzy kodem a danymi w bazie. Najwazniejsze zachowanie: usuniecie
 * osoby z listy NIE MOZE wysadzic Dashboardu projektow, ktore ja mialy
 * przypisana — a to jest przypadek, do ktorego przez zwykle uzycie sie nie
 * dojdzie, bo wymaga rozjazdu miedzy kodem a baza.
 *
 *   npx vitest run src/lib/team.test.ts
 */
describe('spojnosc listy zespolu', () => {
  it('identyfikatory sa unikalne', () => {
    const ids = TEAM_MEMBERS.map(m => m.id)
    assert.strictEqual(new Set(ids).size, ids.length, 'powtorzony id rozjechalby przypisania')
  })

  it('kazdy ma adres e-mail i etykiete roli', () => {
    for (const m of TEAM_MEMBERS) {
      assert.ok(m.email.includes('@'), `${m.id} bez adresu`)
      assert.ok(m.roleLabel.length > 0, `${m.id} bez etykiety roli`)
    }
  })

  it('domyslny sklad to CALY zespol', () => {
    assert.deepStrictEqual(DEFAULT_CONTACT_MEMBER_IDS, TEAM_MEMBERS.map(m => m.id))
  })
})

describe('findTeamMember', () => {
  it('znajduje po identyfikatorze', () => {
    assert.strictEqual(findTeamMember(TEAM_MEMBERS[0].id)?.id, TEAM_MEMBERS[0].id)
  })

  it('nieznany identyfikator to undefined, nie wyjatek', () => {
    assert.strictEqual(findTeamMember('ktos-kogo-nie-ma'), undefined)
  })
})

describe('parseContactMemberIds', () => {
  const pierwszy = TEAM_MEMBERS[0].id
  const drugi = TEAM_MEMBERS[1].id

  it('null znaczy BRAK wyboru, czyli pusta lista', () => {
    // Null i pusty ciag to dwie rozne rzeczy w kolumnie, ale obie znacza
    // „nikt nie zostal wybrany".
    assert.deepStrictEqual(parseContactMemberIds(null), [])
    assert.deepStrictEqual(parseContactMemberIds(undefined), [])
  })

  it('pusty ciag to swiadome odznaczenie wszystkich', () => {
    assert.deepStrictEqual(parseContactMemberIds(''), [])
  })

  it('rozpoznaje pojedyncza osobe', () => {
    assert.deepStrictEqual(parseContactMemberIds(pierwszy).map(m => m.id), [pierwszy])
  })

  it('KOLEJNOSC wynika z listy zespolu, nie z zapisu w bazie', () => {
    // Dzieki temu kolejnosc na stronie jest taka sama we wszystkich projektach,
    // niezaleznie od tego, w jakiej kolejnosci admin klikal ptaszki.
    const odwrotnie = parseContactMemberIds(`${drugi},${pierwszy}`)
    assert.deepStrictEqual(odwrotnie.map(m => m.id), [pierwszy, drugi])
  })

  it('NIEZNANY identyfikator jest pomijany, reszta zostaje', () => {
    // To jest ten wazny przypadek: ktos usunal osobe z TEAM_MEMBERS, a w bazie
    // jej id dalej jest. Dashboard ma dzialac dalej, tylko bez niej.
    const wynik = parseContactMemberIds(`${pierwszy},osoba-ktora-odeszla`)
    assert.deepStrictEqual(wynik.map(m => m.id), [pierwszy])
  })

  it('same nieznane identyfikatory daja pusta liste, nie wyjatek', () => {
    assert.deepStrictEqual(parseContactMemberIds('kto-to,nie-wiem'), [])
  })

  it('spacje i puste pozycje sa pomijane', () => {
    assert.deepStrictEqual(
      parseContactMemberIds(` ${pierwszy} , , ${drugi} `).map(m => m.id),
      [pierwszy, drugi]
    )
  })
})

describe('serializeContactMemberIds', () => {
  const pierwszy = TEAM_MEMBERS[0].id

  it('zapisuje wybor po przecinku', () => {
    const wynik = serializeContactMemberIds(TEAM_MEMBERS.map(m => m.id))
    assert.strictEqual(wynik, TEAM_MEMBERS.map(m => m.id).join(','))
  })

  it('odfiltrowuje identyfikatory spoza zespolu', () => {
    // Wartosc przychodzi z zadania HTTP, wiec nie moze trafic do bazy bez
    // sprawdzenia — trasa `/api/admin/*` przyjmuje token i omija panel.
    assert.strictEqual(serializeContactMemberIds([pierwszy, 'wstrzykniete']), pierwszy)
  })

  it('pusty wybor zapisuje sie jako PUSTY CIAG, nie jako null', () => {
    // Pusty ciag znaczy „swiadomie odznaczono wszystkich", null znaczy
    // „domyslnie caly zespol". Zlanie tych dwoch przywrocilo by kontakty,
    // ktore ktos celowo usunal.
    assert.strictEqual(serializeContactMemberIds([]), '')
  })

  it('to, co zapisane, daje sie odczytac z powrotem', () => {
    const wybor = [pierwszy]
    const odczytane = parseContactMemberIds(serializeContactMemberIds(wybor))
    assert.deepStrictEqual(odczytane.map(m => m.id), wybor)
  })
})
