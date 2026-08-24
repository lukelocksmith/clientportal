import { describe, it, beforeEach, vi } from 'vitest'
import assert from 'node:assert'

/**
 * Przeklad zdarzenia webhooka na powiadomienie.
 *
 * Ten plik odpowiada na jedno pytanie: KTORY komentarz jest zdarzeniem. Latwo
 * to zrobic zle na dwa sposoby i oba widzi klient:
 *
 * - powiadomic o komentarzu WEWNETRZNYM, czyli o tresci, ktorej klient nie
 *   widzi w portalu,
 * - powiadomic o NIE TYM komentarzu, bo webhook przychodzi takze przy EDYCJI
 *   starego wpisu, a najnowszy w watku jest wtedy zupelnie inny.
 *
 *   npx vitest run src/lib/notifyFromWebhook.test.ts
 */
const { clickup, producent } = vi.hoisted(() => ({
  clickup: { getTaskComments: vi.fn() },
  producent: { produceNotifications: vi.fn(async () => ({ bell: 1, mailed: 1 })) },
}))
vi.mock('./clickup', () => clickup)
vi.mock('./notifyProducer', () => producent)

import { notifyOnComment } from './notifyFromWebhook'

/** Komentarz w ksztalcie, w jakim oddaje go API ClickUpa. */
function komentarz(nadpisz: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    comment_text: '[P] gotowe',
    date: '1000',
    user: { username: 'Artem Titov' },
    ...nadpisz,
  }
}

const wejscie = { portalId: 'portal-1', taskId: 'zad-1', taskName: 'Filtry na mobile' }

/** Argument, z jakim wolano producenta. Rzutowanie w jednym miejscu, nie w kazdym tescie. */
function wywolanie(nr = 0): Record<string, unknown> {
  const calls = producent.produceNotifications.mock.calls as unknown as Array<[Record<string, unknown>]>
  assert.ok(calls[nr], `producent nie zostal wolany (${nr})`)
  return calls[nr][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  producent.produceNotifications.mockResolvedValue({ bell: 1, mailed: 1 })
})

describe('ktory komentarz jest zdarzeniem', () => {
  it('bierze NAJNOWSZY komentarz, nie pierwszy z listy', async () => {
    clickup.getTaskComments.mockResolvedValue([
      komentarz({ id: 'stary', comment_text: '[P] pierwsza odpowiedz', date: '1000' }),
      komentarz({ id: 'nowy', comment_text: '[P] druga odpowiedz', date: '2000' }),
    ])

    await notifyOnComment(wejscie)

    const arg = wywolanie()
    assert.strictEqual(arg.clickupCommentId, 'nowy')
    assert.strictEqual(arg.excerpt, 'druga odpowiedz')
  })

  it('kolejnosc w odpowiedzi ClickUpa nie decyduje, decyduje data', async () => {
    clickup.getTaskComments.mockResolvedValue([
      komentarz({ id: 'nowy', comment_text: '[P] nowszy', date: '5000' }),
      komentarz({ id: 'stary', comment_text: '[P] starszy', date: '1000' }),
    ])

    await notifyOnComment(wejscie)

    const arg = wywolanie()
    assert.strictEqual(arg.clickupCommentId, 'nowy')
  })

  it('przekazuje autora i tresc bez znacznika', async () => {
    clickup.getTaskComments.mockResolvedValue([
      komentarz({ comment_text: '[P] Poprawione, sprawdź proszę' }),
    ])

    await notifyOnComment(wejscie)

    const arg = wywolanie()
    assert.strictEqual(arg.author, 'Artem Titov')
    assert.strictEqual(arg.excerpt, 'Poprawione, sprawdź proszę')
    assert.strictEqual(arg.event, 'comment')
  })
})

describe('czego NIE zglaszamy', () => {
  it('komentarz wewnetrzny, bez znacznika, nie powiadamia', async () => {
    // Klient nie widzi go w portalu, wiec powiadomienie prowadziloby do tresci,
    // ktorej nie ma. To ta sama granica co przy odczycie watku.
    clickup.getTaskComments.mockResolvedValue([
      komentarz({ comment_text: 'wewnetrzne: klient nie zaplacil faktury' }),
    ])

    const wynik = await notifyOnComment(wejscie)

    assert.strictEqual(producent.produceNotifications.mock.calls.length, 0)
    assert.strictEqual(wynik.bell, 0)
  })

  it('gdy NAJNOWSZY jest wewnetrzny, nie cofamy sie do starszego publicznego', async () => {
    // Inaczej edycja wewnetrznej notatki wysylalaby klientowi powiadomienie o
    // odpowiedzi sprzed tygodnia.
    clickup.getTaskComments.mockResolvedValue([
      komentarz({ id: 'stary-publiczny', comment_text: '[P] odpowiedz', date: '1000' }),
      komentarz({ id: 'nowa-notatka', comment_text: 'notatka zespolu', date: '2000' }),
    ])

    await notifyOnComment(wejscie)

    assert.strictEqual(producent.produceNotifications.mock.calls.length, 0)
  })

  it('zadanie bez komentarzy nie wywala webhooka', async () => {
    clickup.getTaskComments.mockResolvedValue([])

    const wynik = await notifyOnComment(wejscie)

    assert.deepStrictEqual(wynik, { bell: 0, mailed: 0, reason: 'channel-off' })
  })

  it('awaria ClickUpa nie wywala webhooka', async () => {
    // Blad zwrocony z trasy webhooka sprawia, ze ClickUp ponawia, a po serii
    // nieudanych prob WYLACZA subskrypcje i zabiera przy okazji indeksowanie.
    clickup.getTaskComments.mockRejectedValue(new Error('ClickUp 500'))

    const wynik = await notifyOnComment(wejscie)

    assert.strictEqual(wynik.bell, 0)
    assert.strictEqual(wynik.reason, 'error')
  })
})

describe('wycinek jest tym, co widzi klient', () => {
  it('ZGLOSZENIE: oznaczenie osoby z zespolu nie wchodzi do powiadomienia', async () => {
    // Znalezione 2026-08-24 przy sprawdzaniu na zywo: w dzwonku wyszlo
    // „@Paulina Andrzejewska Duplikat rozmiaru...", czyli wzmianka, ktora tego
    // samego dnia zostala usunieta z tresci komentarza w portalu. Powiadomienie
    // MUSI iSC ta sama sciezka co widok, inaczej pokazuje klientowi co innego.
    clickup.getTaskComments.mockResolvedValue([
      {
        id: 'k1',
        date: '1000',
        comment_text: '[P]\n@Paulina Andrzejewska\nDuplikat rozmiaru 8 został usunięty.',
        user: { username: 'Artem' },
        comment: [
          { text: '[P]' },
          { text: '\n', attributes: { 'block-id': 'b1' } },
          { type: 'tag', text: '@Paulina Andrzejewska', user: { username: 'Paulina Andrzejewska' } },
          { text: '\n', attributes: { 'block-id': 'b2' } },
          { text: 'Duplikat rozmiaru 8 został usunięty.' },
        ],
      },
    ])

    await notifyOnComment(wejscie)

    const arg = wywolanie()
    assert.strictEqual(String(arg.excerpt).includes('Paulina'), false, 'nazwisko w powiadomieniu')
    assert.strictEqual(arg.excerpt, 'Duplikat rozmiaru 8 został usunięty.')
  })

  it('wzmianka o ZADANIU wchodzi nazwa, nie identyfikatorem', async () => {
    clickup.getTaskComments.mockResolvedValue([
      {
        id: 'k1',
        date: '1000',
        comment_text: '[P] poprawione w 869abc',
        user: { username: 'Artem' },
        comment: [
          { text: '[P] poprawione w ' },
          { text: '869abc', type: 'task_mention', task_mention: { task_id: '869abc' } },
        ],
      },
    ])

    await notifyOnComment(wejscie)

    const arg = wywolanie()
    // Nazwy zadania producent nie zna (rozwiazuje ja trasa odczytu), wiec do
    // powiadomienia wchodzi samo zdanie bez identyfikatora. Goly identyfikator
    // byl trescia zgloszenia z tego samego dnia.
    assert.strictEqual(String(arg.excerpt).includes('869abc'), false, 'identyfikator w powiadomieniu')
  })

  it('komentarz bez blokow (starszy zapis) nadal daje wycinek', async () => {
    clickup.getTaskComments.mockResolvedValue([
      { id: 'k1', date: '1000', comment_text: '[P] gotowe', user: { username: 'Artem' } },
    ])

    await notifyOnComment(wejscie)

    const arg = wywolanie()
    assert.strictEqual(arg.excerpt, 'gotowe')
  })
})
