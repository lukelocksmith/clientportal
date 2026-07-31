/**
 * Sprawdzenie normalizacji i budowy indeksu wyszukiwania.
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  fold,
  buildSearchText,
  normalizeQuery,
  escapeLikePattern,
  matchesQuery,
} from '@/lib/textSearch'
import {
  filterPublicComments,
  publicCommentTexts,
  isPublicComment,
  stripPublicPrefix,
} from '@/lib/publicComments'
import type { ClickUpComment } from '@/lib/types'

describe('textSearch', () => {

  function comment(id: string, text: string): ClickUpComment {
    return {
      id,
      comment: [{ text }],
      comment_text: text,
      user: null,
      resolved: false,
      date: '0',
    }
  }

  it('fold', () => {
    assert.strictEqual(fold('Ścieżka'), 'sciezka')
    assert.strictEqual(fold('ZAŻÓŁĆ GĘŚLĄ JAŹŃ'), 'zazolc gesla jazn')

    // Sedno sprawy: ł nie jest rozkładalne przez NFD, więc naiwny trik by je
    // przepuścił. Tu musi wyjść "lacze".
    assert.strictEqual(fold('łącze'), 'lacze')
    assert.strictEqual(fold('ŁĄCZE'), 'lacze')
    assert.strictEqual(fold('Wpłata'), 'wplata')

    // Dowód, że naiwna metoda faktycznie zawodzi (gdyby ktoś chciał ją wstawić).
    const naive = 'łącze'.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    assert.strictEqual(naive, 'łacze', 'NFD nie rusza ł — dlatego używamy remove-accents')
    assert.notStrictEqual(naive, fold('łącze'))

    // Białe znaki zwijane, żeby wielolinijkowy opis nie psuł dopasowań.
    assert.strictEqual(fold('  dwa   słowa \n trzy  '), 'dwa slowa trzy')
  })

  it('query normalization', () => {
    assert.strictEqual(normalizeQuery('Ścieżka'), 'sciezka')
    assert.strictEqual(normalizeQuery(''), null)
    assert.strictEqual(normalizeQuery('   '), null)
    assert.strictEqual(normalizeQuery(null), null)
    assert.strictEqual(normalizeQuery(undefined), null)

    // Obie strony złożone: klient pisze z ogonkami, indeks jest bez.
    const idx = buildSearchText({ name: 'Poprawić łącze w stopce' })
    assert.ok(matchesQuery(idx, 'łącze'), 'fraza z ogonkami trafia w indeks bez ogonków')
    assert.ok(matchesQuery(idx, 'lacze'), 'fraza bez ogonków też trafia')
    assert.ok(matchesQuery(idx, 'ŁĄCZE'), 'wielkość liter bez znaczenia')
    assert.ok(!matchesQuery(idx, 'nagłówek'))

    // Pusta fraza nie może niczego filtrować.
    assert.ok(matchesQuery(idx, ''))
  })

  it('like escaping', () => {
    // Bez escapowania "100%" dopasowałoby wszystko.
    assert.strictEqual(escapeLikePattern('100%'), '100\\%')
    assert.strictEqual(escapeLikePattern('a_b'), 'a\\_b')
    assert.strictEqual(escapeLikePattern('c:\\temp'), 'c:\\\\temp')
    assert.strictEqual(escapeLikePattern('zwykły tekst'), 'zwykły tekst')
  })

  it('public filter', () => {
    assert.ok(isPublicComment('[PUBLIC] cokolwiek'))
    // ZMIANA REGUŁY 2026-07-30: krótszy prefiks `[P]`, dopasowanie tolerancyjne
    // (wielkość liter, brak spacji, dowolne miejsce w treści). Te dwie asercje
    // były wcześniej odwrócone i kodowały dosłowne `startsWith('[PUBLIC] ')`.
    // Pełny zestaw przypadków jest w publicComments.test.ts.
    assert.ok(isPublicComment('[Public] inna wielkość liter'))
    assert.ok(isPublicComment('[PUBLIC]bez spacji'))
    assert.ok(isPublicComment('[P] krótki prefiks'))
    assert.ok(isPublicComment('gotowe, sprawdź [P]'), 'znacznik na końcu treści')
    assert.ok(!isPublicComment('wewnętrzna uwaga zespołu'))
    // Granica pozostaje wąska: inne oznaczenia w nawiasach nie przechodzą.
    assert.ok(!isPublicComment('[Pilne] poprawić do wtorku'))
    assert.ok(!isPublicComment(null))
    assert.ok(!isPublicComment(undefined))

    assert.deepStrictEqual(stripPublicPrefix('[PUBLIC] (Dorota) dzięki'), {
      text: 'dzięki',
      sender: 'Dorota',
    })
    assert.deepStrictEqual(stripPublicPrefix('[PUBLIC] robimy'), {
      text: 'robimy',
      sender: 'important.is',
    })

    const mixed = [
      comment('1', '[PUBLIC] Poprawione, prosimy o sprawdzenie'),
      comment('2', 'Klient znowu marudzi, doliczyć godziny'),
      comment('3', '[PUBLIC] (Mikołaj) działa, dziękuję'),
      // Po zmianie reguły to JEST komentarz publiczny: wcześniej inna wielkość
      // liter cicho blokowała odpowiedź, a autor widział ją w ClickUpie i
      // zakładał, że dotarła.
      comment('4', '[Public] inna wielkość liter'),
      comment('5', '[Pilne] wewnętrzne, nie pokazywać klientowi'),
    ]

    const shown = filterPublicComments(mixed)
    assert.strictEqual(shown.length, 3, 'przechodzą trzy komentarze oznaczone')
    assert.deepStrictEqual(shown.map(c => c.sender), ['important.is', 'Mikołaj', 'important.is'])

    const texts = publicCommentTexts(mixed)
    assert.strictEqual(texts.length, 3)
    // Asercja, o którą w tym teście naprawdę chodzi: nic wewnętrznego nie wyszło.
    assert.ok(!texts.join(' ').includes('marudzi'))
    assert.ok(!texts.join(' ').includes('nie pokazywać'))
  })

  it('index never leaks internal', () => {
    // Najważniejszy test w tym pliku: wewnętrzny komentarz nie ma prawa
    // znaleźć się w indeksie, ani wprost, ani przez wyszukiwanie.
    const comments = [
      comment('1', '[PUBLIC] Zmieniliśmy opis produktu'),
      comment('2', 'UWAGA WEWNĘTRZNA: klient przepłaca, nie mówić'),
    ]

    const index = buildSearchText({
      name: 'Błąd w opisie produktu',
      description: 'Na stronie kategorii jest zła cena',
      publicComments: publicCommentTexts(comments),
      attachmentNames: ['zrzut-ekranu.png'],
    })

    assert.ok(!index.includes('przeplaca'), 'wewnętrzny komentarz NIE wchodzi do indeksu')
    assert.ok(!index.includes('wewnetrzna'), 'nawet nagłówek wewnętrznej uwagi nie wchodzi')
    assert.ok(!matchesQuery(index, 'przepłaca'), 'i nie da się go znaleźć wyszukiwarką')

    // A to, co ma być przeszukiwalne, jest.
    assert.ok(matchesQuery(index, 'zmieniliśmy'), 'komentarz publiczny jest przeszukiwalny')
    assert.ok(matchesQuery(index, 'zrzut-ekranu'), 'nazwa załącznika jest przeszukiwalna')
    assert.ok(matchesQuery(index, 'kategorii'), 'opis jest przeszukiwalny')
    assert.ok(matchesQuery(index, 'błąd'), 'nazwa jest przeszukiwalna')
  })

  it('boundary between chunks', () => {
    // Separatorem jest nowa linia, więc fraza nie może trafić w zlepienie
    // końca jednego fragmentu z początkiem następnego.
    const index = buildSearchText({ name: 'abc', description: 'def' })
    assert.ok(!index.includes('abcdef'), 'fragmenty nie zlepiają się w jeden ciąg')
    assert.ok(matchesQuery(index, 'abc'))
    assert.ok(matchesQuery(index, 'def'))

    // Puste fragmenty nie zostawiają pustych linii.
    const sparse = buildSearchText({ name: 'sama nazwa', description: '', publicComments: [] })
    assert.strictEqual(sparse, 'sama nazwa')
  })



})
