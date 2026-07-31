/**
 * Atrybucja zgłoszeń: kto zgłosił, jak go podpisujemy w ClickUpie.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  normalizeActorId,
  isAdminActor,
  reporterLabel,
  reporterFooter,
  withReporterFooter,
  ADMIN_ACTOR_EMAIL,
  type Reporter,
} from '@/lib/reporter'

const KLIENT: Reporter = {
  name: 'Anna Kowalska',
  email: 'anna@onyx.pl',
  portalName: 'Onyx',
  portalSlug: 'onyx',
  source: 'form',
}

describe('normalizeActorId', () => {
  it("zamienia 'admin' na null, bo kolumny user_id sa typu uuid", () => {
    // To jest sedno: 'admin'::uuid to blad bazy, a insert leci w try/catch,
    // wiec bez tej normalizacji zapis ginal po cichu (tak dzialalo ai_usage).
    assert.strictEqual(normalizeActorId('admin'), null)
    assert.strictEqual(normalizeActorId(null), null)
    assert.strictEqual(normalizeActorId(undefined), null)
    assert.strictEqual(normalizeActorId(''), null)

    // Prawdziwe uuid przechodzi bez zmian.
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    assert.strictEqual(normalizeActorId(uuid), uuid)
  })
})

describe('isAdminActor', () => {
  it('rozpoznaje admina po userId i po adresie', () => {
    assert.strictEqual(isAdminActor({ userId: 'admin' }), true)
    assert.strictEqual(isAdminActor({ email: ADMIN_ACTOR_EMAIL }), true)
    assert.strictEqual(isAdminActor({ userId: 'x', email: 'anna@onyx.pl' }), false)
    assert.strictEqual(isAdminActor({}), false)
  })
})

describe('reporterLabel', () => {
  it('imie z adresem, a bez imienia sam adres', () => {
    assert.strictEqual(reporterLabel({ name: 'Anna', email: 'a@onyx.pl' }), 'Anna <a@onyx.pl>')
    // Konto z zaproszenia moze nie miec imienia. Nie chcemy wtedy "null <...>".
    assert.strictEqual(reporterLabel({ name: null, email: 'a@onyx.pl' }), 'a@onyx.pl')
    assert.strictEqual(reporterLabel({ name: '   ', email: 'a@onyx.pl' }), 'a@onyx.pl')
  })
})

describe('reporterFooter', () => {
  it('zawiera osobe, projekt i kanal', () => {
    const footer = reporterFooter(KLIENT)
    assert.ok(footer.includes('Anna Kowalska <anna@onyx.pl>'), 'brak podpisu osoby')
    assert.ok(footer.includes('Onyx (/onyx)'), 'brak projektu')
    assert.ok(footer.includes('formularz w portalu'), 'brak kanalu')
    assert.ok(footer.startsWith('---'), 'stopka musi byc odkreslona od tresci')
  })

  it('kanal rozroznia formularz, AI, pomysl, alarm i komentarz', () => {
    const kanaly = (['form', 'ai', 'idea', 'panic', 'comment'] as const).map(
      source => reporterFooter({ ...KLIENT, source }).split('\n').at(-1)!
    )
    // Kazdy kanal ma wlasny opis: inaczej nie dalo by sie odroznic zgloszenia
    // z formularza od rozmowy z asystentem.
    assert.strictEqual(new Set(kanaly).size, 5, 'kanaly musza byc rozroznialne')
  })

  it('zadanie utworzone w trybie admina jest oznaczone WPROST', () => {
    const footer = reporterFooter({ ...KLIENT, name: 'Admin', email: ADMIN_ACTOR_EMAIL })
    assert.ok(footer.includes('tryb administratora'), 'brak oznaczenia trybu admina')
    assert.ok(
      !footer.includes(ADMIN_ACTOR_EMAIL),
      'adres obejsciowy nie ma sie pojawiac jako zglaszajacy klient'
    )
  })
})

describe('withReporterFooter', () => {
  it('stopka na koncu, tresc nietknieta', () => {
    const out = withReporterFooter('Prosze poprawic formularz kontaktowy.', KLIENT)
    assert.ok(out.startsWith('Prosze poprawic formularz kontaktowy.'), 'tresc musi byc pierwsza')
    assert.ok(out.includes('Zgłoszone przez:'))
    // Pierwsze linie widac w podgladzie ClickUpa i w powiadomieniach, wiec
    // naleza do zgloszenia, nie do metadanych.
    assert.strictEqual(out.split('\n')[0], 'Prosze poprawic formularz kontaktowy.')
  })

  it('pusty opis dostaje sama stopke, bez wiszacych pustych linii', () => {
    for (const empty of [null, undefined, '', '   \n  ']) {
      const out = withReporterFooter(empty, KLIENT)
      assert.ok(out.startsWith('---'), `pusty opis (${JSON.stringify(empty)}) zostawil smieci`)
      assert.ok(out.includes('Anna Kowalska'), 'stopka musi byc nawet przy pustym opisie')
    }
  })
})
