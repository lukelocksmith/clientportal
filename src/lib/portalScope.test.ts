/**
 * Zakres portalu: KTORE listy z folderu klienta naleza do jego portalu.
 *
 * Test bezpieczenstwa i rozliczen, nie formatowania. Blad w jedna strone
 * oznacza, ze klient widzi zadania i GODZINY z listy, ktorej mu nie
 * udostepnilismy, w druga, ze znika mu z tablicy jego wlasna praca.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  scopeLimits,
  isListInScope,
  filterTasksToScope,
  filterTimeEntriesToScope,
  scopeCacheKey,
  taskBelongsToPortal,
} from '@/lib/portalScope'
import type { ClickUpTask, ClickUpTimeEntry } from '@/lib/types'

const WYBRANA = 'lista-portalu'
const OBCA = 'lista-wewnetrzna'
const ZAKRES = [WYBRANA]

/**
 * `list` w ClickUpTask jest polem WYMAGANYM, ale odpowiedz z API moze go nie
 * miec. Rzutowanie jest tu celowe: testujemy wlasnie ten przypadek, bo od niego
 * zalezy, czy brak potwierdzenia listy przepuszcza zadanie do portalu.
 */
type ZakresowaneZadanie = Pick<ClickUpTask, 'list'>

const zadanie = (listId: string | null): ZakresowaneZadanie =>
  ({ list: listId === null ? undefined : { id: listId, name: 'x' } }) as unknown as ZakresowaneZadanie

const wpis = (listId: string | null): ClickUpTimeEntry =>
  ({
    id: 'e', duration: '3600000', start: '0', end: '1',
    task: { id: 't', name: 'n', status: { status: 's' } },
    task_location: { list_id: listId, folder_id: 'f', space_id: 's' },
  }) as ClickUpTimeEntry

describe('scopeLimits', () => {
  it('pusty zakres NIE zawęza, czyli znaczy caly folder', () => {
    // Zgodnosc w tyl: portal bez skonfigurowanych list dzialal na calym
    // folderze, a nagle pokazanie mu pustej tablicy byloby gorsze niz blad,
    // ktory naprawiamy.
    assert.strictEqual(scopeLimits([]), false)
    assert.strictEqual(scopeLimits(ZAKRES), true)
  })
})

describe('isListInScope', () => {
  it('przy pustym zakresie przechodzi wszystko', () => {
    assert.strictEqual(isListInScope(OBCA, []), true)
    assert.strictEqual(isListInScope(null, []), true)
  })

  it('przy zawężonym zakresie przechodzi TYLKO wybrana lista', () => {
    assert.strictEqual(isListInScope(WYBRANA, ZAKRES), true)
    assert.strictEqual(isListInScope(OBCA, ZAKRES), false)
  })

  it('brak informacji o liscie to ODMOWA, nie przepustka', () => {
    // Przy danych widocznych dla klienta brak potwierdzenia traktujemy jak
    // odmowe. Odwrotna decyzja oznaczalaby, ze wystarczy brakujace pole
    // w odpowiedzi ClickUpa, zeby zadanie wyciekło do portalu.
    assert.strictEqual(isListInScope(null, ZAKRES), false)
    assert.strictEqual(isListInScope(undefined, ZAKRES), false)
    assert.strictEqual(isListInScope('', ZAKRES), false)
  })
})

describe('filterTasksToScope', () => {
  it('zostawia zadania wybranej listy, odrzuca pozostale', () => {
    const wynik = filterTasksToScope(
      [zadanie(WYBRANA), zadanie(OBCA), zadanie(WYBRANA), zadanie(null)],
      ZAKRES
    )
    assert.strictEqual(wynik.length, 2, 'przeszly tylko zadania wybranej listy')
  })

  it('pusty zakres nie rusza zbioru', () => {
    const wejscie = [zadanie(WYBRANA), zadanie(OBCA)]
    assert.strictEqual(filterTasksToScope(wejscie, []).length, 2)
  })

  it('dwie listy w zakresie przepuszczaja obie', () => {
    const wynik = filterTasksToScope([zadanie(WYBRANA), zadanie(OBCA)], [WYBRANA, OBCA])
    assert.strictEqual(wynik.length, 2)
  })
})

describe('filterTimeEntriesToScope', () => {
  it('do raportu wchodza godziny TYLKO z list portalu', () => {
    // To jest liczba, ktora klient porownuje z faktura. Wpis z listy, ktorej
    // mu nie udostepnilismy, nie ma prawa jej podbijac.
    const wynik = filterTimeEntriesToScope([wpis(WYBRANA), wpis(OBCA), wpis(WYBRANA)], ZAKRES)
    assert.strictEqual(wynik.length, 2)
  })

  it('stoper odpalony poza zadaniem NIE wchodzi do raportu przy zawężonym zakresie', () => {
    // `list_id` rowne null oznacza czas nieprzypisany do zadania. Nie da sie
    // stwierdzic, ze dotyczy pracy tego klienta.
    assert.strictEqual(filterTimeEntriesToScope([wpis(null)], ZAKRES).length, 0)
    // Bez zawężenia zachowanie zostaje jak dotad, czyli wpis sie liczy.
    assert.strictEqual(filterTimeEntriesToScope([wpis(null)], []).length, 1)
  })
})

describe('scopeCacheKey', () => {
  it('kolejnosc list NIE zmienia klucza', () => {
    // Inaczej ten sam zestaw list dalby dwa wpisy w cache'u, a zmiana
    // kolejnosci w panelu wygladalaby jak wyczyszczenie bufora.
    assert.strictEqual(scopeCacheKey(['b', 'a']), scopeCacheKey(['a', 'b']))
  })

  it('rozne zestawy daja rozne klucze, a pusty ma wlasny', () => {
    assert.notStrictEqual(scopeCacheKey(['a']), scopeCacheKey(['a', 'b']))
    assert.notStrictEqual(scopeCacheKey([]), scopeCacheKey(['a']))
    assert.strictEqual(scopeCacheKey([]), 'caly-folder')
  })
})

describe('taskBelongsToPortal', () => {
  const zadanie = (folderId: string | undefined, listId?: string) => ({
    folder: folderId === undefined ? null : { id: folderId },
    list: listId === undefined ? null : { id: listId },
  })

  it('inny folder -> nie nalezy, nawet gdy lista jest w zakresie', () => {
    assert.strictEqual(taskBelongsToPortal(zadanie('obcy', 'a'), 'moj', ['a']), false)
  })

  it('wlasciwy folder, pusty zakres -> nalezy', () => {
    assert.strictEqual(taskBelongsToPortal(zadanie('moj', 'dowolna'), 'moj', []), true)
  })

  it('wlasciwy folder, lista poza zakresem -> NIE nalezy', () => {
    // To jest ta luka, przez ktora klient EFF widzial zadania z listy "EFF SEO":
    // sam folder sie zgadza, a lista nigdy nie zostala do portalu wybrana.
    assert.strictEqual(taskBelongsToPortal(zadanie('moj', 'eff-seo'), 'moj', ['eff-portal']), false)
  })

  it('wlasciwy folder, lista w zakresie -> nalezy', () => {
    assert.strictEqual(taskBelongsToPortal(zadanie('moj', 'eff-portal'), 'moj', ['eff-portal']), true)
  })

  it('brak informacji o folderze -> odmowa, nie przepuszczenie', () => {
    // Brak potwierdzenia traktujemy jak odmowe, bo to sa dane widoczne dla klienta.
    assert.strictEqual(taskBelongsToPortal(zadanie(undefined), 'moj', []), false)
  })

  it('brak informacji o liscie przy zawezonym zakresie -> odmowa', () => {
    assert.strictEqual(taskBelongsToPortal(zadanie('moj'), 'moj', ['a']), false)
  })
})
