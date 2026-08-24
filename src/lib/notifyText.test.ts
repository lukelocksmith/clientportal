import { describe, it } from 'vitest'
import assert from 'node:assert'
import { bellPayload, mailText } from './notifyText'

/**
 * Tresc powiadomienia: to, co klient widzi w dzwonku i czyta w mailu.
 *
 * Dwie reguly, ktore te testy pilnuja:
 *
 * 1. **Powiadomienie nie zastepuje tresci.** Nie wklejamy calego komentarza do
 *    maila, tylko mowimy, ze jest odpowiedz, i dajemy link. Pelna korespondencja
 *    zostaje w portalu, za logowaniem: mail idzie przez cudze serwery i moze
 *    zostac przekazany dalej.
 * 2. **Zadne pole nie moze wyjsc jako `undefined` ani jako surowy klucz.** Brak
 *    danych (nieznany status, komentarz bez tresci) konczy sie zdaniem po
 *    polsku, nie dziura w mailu do klienta.
 *
 *   npx vitest run src/lib/notifyText.test.ts
 */

const bazowe = {
  taskName: 'Nie działające filtry mobile',
  portalName: 'Onyx',
  taskUrl: 'https://portal.important.is/onyx?task=869abc',
}

describe('dzwonek', () => {
  it('odpowiedz zespolu niesie autora i wycinek', () => {
    const payload = bellPayload({
      ...bazowe,
      event: 'comment',
      author: 'Artem',
      excerpt: 'Poprawione, sprawdź proszę',
    })

    assert.deepStrictEqual(payload, { author: 'Artem', excerpt: 'Poprawione, sprawdź proszę' })
  })

  it('wycinek jest przycinany, bo dzwonek to jedna linia', () => {
    const payload = bellPayload({
      ...bazowe,
      event: 'comment',
      author: 'Artem',
      excerpt: 'x'.repeat(400),
    })

    assert.ok((payload.excerpt as string).length <= 160, 'wycinek za dlugi')
    assert.match(payload.excerpt as string, /…$/, 'brak znaku urwania')
  })

  it('zmiana statusu niesie skad i dokad', () => {
    const payload = bellPayload({ ...bazowe, event: 'status', fromStatus: 'nowe', toStatus: 'w trakcie' })

    assert.deepStrictEqual(payload, { from: 'nowe', to: 'w trakcie' })
  })

  it('brak danych daje pusty obiekt, nie pola z undefined', () => {
    const payload = bellPayload({ ...bazowe, event: 'created' })

    assert.deepStrictEqual(payload, {})
    assert.strictEqual(JSON.stringify(payload).includes('undefined'), false)
  })
})

describe('mail', () => {
  it('odpowiedz zespolu: temat mowi o co chodzi i o ktore zadanie', () => {
    const mail = mailText({ ...bazowe, event: 'comment', author: 'Artem' })

    assert.match(mail.subject, /odpowied/i)
    assert.match(mail.subject, /Nie działające filtry mobile/)
  })

  it('mail NIE wkleja tresci komentarza, tylko odsyla do portalu', () => {
    const mail = mailText({
      ...bazowe,
      event: 'comment',
      author: 'Artem',
      excerpt: 'hasło do panelu to tajne-haslo-123',
    })
    const calosc = [mail.subject, mail.preview, ...mail.paragraphs].join(' ')

    assert.strictEqual(calosc.includes('tajne-haslo-123'), false, 'tresc komentarza w mailu')
    assert.strictEqual(mail.buttonUrl, bazowe.taskUrl)
  })

  it('zmiana statusu pisze stary i nowy status', () => {
    const mail = mailText({ ...bazowe, event: 'status', fromStatus: 'nowe', toStatus: 'w trakcie' })
    const calosc = mail.paragraphs.join(' ')

    assert.match(calosc, /nowe/)
    assert.match(calosc, /w trakcie/)
  })

  it('zamkniecie sprawy ma wlasny temat, inny niz zwykla zmiana statusu', () => {
    const zamkniete = mailText({ ...bazowe, event: 'closed', toStatus: 'zamknięte' })
    const status = mailText({ ...bazowe, event: 'status', toStatus: 'w trakcie' })

    assert.notStrictEqual(zamkniete.subject, status.subject)
    assert.match(zamkniete.subject, /zamkn/i)
  })

  it('nowe zadanie od agencji ma temat o nowym zadaniu', () => {
    const mail = mailText({ ...bazowe, event: 'created' })

    assert.match(mail.subject, /nowe zadanie/i)
  })

  it('kazde zdarzenie ma pelny zestaw pol, bez pustych miejsc w mailu', () => {
    for (const event of ['comment', 'created', 'status', 'closed'] as const) {
      const mail = mailText({ ...bazowe, event })

      assert.ok(mail.subject.trim().length > 0, `temat dla ${event}`)
      assert.ok(mail.preview.trim().length > 0, `podglad dla ${event}`)
      assert.ok(mail.paragraphs.length > 0, `tresc dla ${event}`)
      assert.ok(mail.buttonLabel.trim().length > 0, `przycisk dla ${event}`)
      const calosc = [mail.subject, mail.preview, mail.buttonLabel, ...mail.paragraphs].join(' ')
      assert.strictEqual(calosc.includes('undefined'), false, `undefined w tresci dla ${event}`)
      // `status` jest wylaczony z tego sprawdzenia, bo po polsku to to samo
      // slowo i „Zmiana statusu" jest poprawna trescia, nie wyciekiem klucza.
      if (event !== 'status') {
        assert.strictEqual(calosc.includes(event), false, `surowy klucz zdarzenia w tresci dla ${event}`)
      }
    }
  })

  it('nieznany status nie zostawia dziury w zdaniu', () => {
    const mail = mailText({ ...bazowe, event: 'status' })
    const calosc = mail.paragraphs.join(' ')

    assert.strictEqual(calosc.includes('undefined'), false)
    assert.ok(calosc.trim().length > 0)
  })
})
