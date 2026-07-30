/**
 * Granica [P] / [PUBLIC]: co dociera do klienta, a co zostaje u nas.
 *
 * To jest test bezpieczenstwa, nie formatowania. Blad w jedna strone oznacza
 * niedostarczona odpowiedz, w druga wyciek wewnetrznej korespondencji agencji
 * do portalu klienta i do przeszukiwalnego indeksu Historii.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  PUBLIC_PREFIX,
  isPublicComment,
  stripPublicPrefix,
  filterPublicComments,
  publicCommentTexts,
} from '@/lib/publicComments'
import type { ClickUpComment } from '@/lib/types'

function comment(text: string): ClickUpComment {
  return { id: text.slice(0, 8), comment_text: text, date: '0', user: { id: 1, username: 'x' } } as ClickUpComment
}

describe('isPublicComment', () => {
  it('przepuszcza [P] i [PUBLIC] niezaleznie od wielkosci liter i spacji', () => {
    const przechodzi = [
      '[P] gotowe',
      '[p] gotowe',
      '[P]bez spacji',
      '[ P ] ze spacjami w nawiasie',
      '[PUBLIC] stary prefiks nadal dziala',
      '[public] mala litera',
      '  [P] wciecie przed znacznikiem',
    ]
    for (const text of przechodzi) {
      assert.strictEqual(isPublicComment(text), true, `powinno przejsc: ${JSON.stringify(text)}`)
    }
  })

  it('znacznik liczy sie w DOWOLNYM miejscu tresci', () => {
    // Decyzja Lukasza: przy pisaniu z telefonu pozycja kursora jest przypadkowa.
    assert.strictEqual(isPublicComment('gotowe, mozesz sprawdzac [P]'), true, 'na koncu')
    assert.strictEqual(isPublicComment('juz [P] poprawione'), true, 'w srodku')
    assert.strictEqual(isPublicComment('linia\ndruga [P]\ntrzecia'), true, 'w kolejnej linii')
  })

  it('NIE przepuszcza komentarza bez znacznika', () => {
    const zostaje = [
      'zrobione, ale nie mow klientowi',
      'PUBLIC bez nawiasow',
      'P',
      '',
    ]
    for (const text of zostaje) {
      assert.strictEqual(isPublicComment(text), false, `nie powinno przejsc: ${JSON.stringify(text)}`)
    }
    assert.strictEqual(isPublicComment(null), false)
    assert.strictEqual(isPublicComment(undefined), false)
  })

  it('NIE przepuszcza innych oznaczen w nawiasach', () => {
    // Wzorzec jest zamkniety na dokladnie `p` albo `public`. Przy dopasowaniu w
    // dowolnym miejscu kazde poszerzenie to nowa droga wycieku.
    const obce = [
      '[Pilne] poprawic do wtorku',
      '[PL] wersja polska',
      '[Priorytet] wysoki',
      '[PM] pytanie do Pauliny',
      '[przypomnienie] dopytac klienta',
    ]
    for (const text of obce) {
      assert.strictEqual(isPublicComment(text), false, `nie powinno przejsc: ${JSON.stringify(text)}`)
    }
  })
})

describe('stripPublicPrefix', () => {
  it('zdejmuje znacznik z poczatku i podpisuje agencje', () => {
    assert.deepStrictEqual(stripPublicPrefix('[P] gotowe'), { text: 'gotowe', sender: 'Important.is' })
    assert.deepStrictEqual(stripPublicPrefix('[PUBLIC] gotowe'), { text: 'gotowe', sender: 'Important.is' })
  })

  it('rozpoznaje autora po stronie klienta', () => {
    const { text, sender } = stripPublicPrefix(`${PUBLIC_PREFIX}(Anna) prosze o poprawke`)
    assert.strictEqual(sender, 'Anna')
    assert.strictEqual(text, 'prosze o poprawke')
  })

  it('usuwa znacznik ze srodka bez zlepiania slow', () => {
    assert.strictEqual(stripPublicPrefix('juz [P] poprawione').text, 'juz poprawione')
    assert.strictEqual(stripPublicPrefix('gotowe [P]').text, 'gotowe')
    // Dwa znaczniki to nie blad uzytkownika wart pokazywania klientowi.
    assert.strictEqual(stripPublicPrefix('[P] gotowe [P]').text, 'gotowe')
  })

  it('nie rusza wciec w kolejnych liniach', () => {
    // Znacznik na koncu linii schodzi bez sladu, ale lista markdown ponizej
    // musi zostac wcieta, bo inaczej zmienia sie formatowanie tresci.
    const out = stripPublicPrefix('[P] zrobione:\n  - punkt pierwszy\n  - punkt drugi').text
    assert.strictEqual(out, 'zrobione:\n  - punkt pierwszy\n  - punkt drugi')
  })
})

describe('filterPublicComments', () => {
  it('wpuszcza tylko oznaczone i zdejmuje z nich znacznik', () => {
    const wejscie = [
      comment('[P] Poprawione, sprawdz prosze.'),
      comment('wewnetrzne: klient nie zaplacil jeszcze faktury'),
      comment('[PUBLIC] (Anna) dziekuje'),
      comment('do zrobienia po godzinach'),
    ]
    const wynik = filterPublicComments(wejscie)

    assert.strictEqual(wynik.length, 2, 'przeszly tylko dwa oznaczone')
    assert.deepStrictEqual(
      wynik.map(c => c.comment_text),
      ['Poprawione, sprawdz prosze.', 'dziekuje']
    )
    assert.deepStrictEqual(wynik.map(c => c.sender), ['Important.is', 'Anna'])

    // Najwazniejsza asercja tego pliku: zadna wewnetrzna tresc nie wyszla.
    const wyjscie = wynik.map(c => c.comment_text).join(' ')
    assert.ok(!wyjscie.includes('faktury'), 'WYCIEK wewnetrznego komentarza')
    assert.ok(!wyjscie.includes('po godzinach'), 'WYCIEK wewnetrznego komentarza')
  })
})

describe('publicCommentTexts', () => {
  it('do indeksu wyszukiwania wchodza tylko tresci publiczne', () => {
    const teksty = publicCommentTexts([
      comment('[P] zmiana koloru naglowka'),
      comment('budzet klienta konczy sie w marcu'),
      comment('[P]   '),
    ])
    // Komentarz oznaczony, ale pusty po zdjeciu znacznika, nie wnosi nic do
    // wyszukiwania i tylko podbijalby licznik.
    assert.deepStrictEqual(teksty, ['zmiana koloru naglowka'])
  })
})
