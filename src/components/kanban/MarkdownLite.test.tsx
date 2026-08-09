/**
 * Renderowanie markdownu w opisach zadań i komentarzach zespołu.
 *
 * Zgłoszenie Łukasza 2026-08-09: komentarz z markdownem pokazywał się
 * klientowi jako surowy tekst ze znakami `##` i `**`. Test rendersuje
 * PRAWDZIWY komponent (renderToStaticMarkup), nie duplikuje jego logiki
 * w osobnych asercjach na regexy — inaczej test mógłby przejść, a komponent
 * i tak renderować źle.
 *
 *   npm test
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownLite } from './MarkdownLite'

const render = (text: string) => renderToStaticMarkup(<MarkdownLite text={text} />)

describe('MarkdownLite', () => {
  it('renderuje naglowek, liste i pogrubienie jako HTML, nie jako znaki markdown', () => {
    const html = render('## Nagłówek\n\n- punkt pierwszy\n- punkt drugi\n\n**ważne**')

    assert.ok(html.includes('<h4'), 'brak <h4> dla ##')
    assert.ok(html.includes('Nagłówek'), 'tekst nagłówka zniknął')
    assert.ok(!html.includes('##'), 'surowe ## przeciekło do HTML')

    assert.ok(html.includes('<ul'), 'brak <ul> dla listy')
    assert.match(html, /<li[^>]*>punkt pierwszy<\/li>/)
    assert.match(html, /<li[^>]*>punkt drugi<\/li>/)

    assert.ok(html.includes('<strong>ważne</strong>'), 'pogrubienie nie stało się <strong>')
    assert.ok(!html.includes('**'), 'surowe ** przeciekło do HTML')
  })

  it('zamienia adres na klikalny link, otwierany w nowej karcie', () => {
    const html = render('zobacz https://portal.important.is/onyx i daj znać')
    assert.match(html, /<a href="https:\/\/portal\.important\.is\/onyx"[^>]*target="_blank"/)
    // Bez tego link otwarty z cudzej strony (mail, dokument) mógłby wywierać
    // kontrolę nad oknem źródłowym przez window.opener.
    assert.ok(html.includes('rel="noopener noreferrer"'), 'brak rel="noopener noreferrer" na linku')
  })

  it('zwykly tekst bez markdownu renderuje sie jako pojedynczy akapit', () => {
    // Zadanie: zero regresji dla treści sprzed tej zmiany.
    const html = render('zwykły komentarz bez żadnych oznaczeń')
    assert.ok(html.includes('<p'), 'zwykły tekst powinien trafić do <p>')
    assert.ok(html.includes('zwykły komentarz bez żadnych oznaczeń'))
    assert.ok(!html.includes('<h4'))
    assert.ok(!html.includes('<ul'))
  })

  it('niesparowane ** nie wywala renderowania, tylko zostaje literalne', () => {
    // Klient pisze naturalnie, nie w markdownie: gwiazdki bez pary są kwestią
    // czasu. Awaria całej szuflady przez jeden źle napisany komentarz byłaby
    // najgorszym możliwym skutkiem literówki.
    const html = render('cena to **50 zł za sztukę, dużo taniej niż zwykle')
    assert.ok(html.length > 0, 'renderowanie nie powinno rzucić wyjątku')
    assert.ok(html.includes('50 zł'), 'treść musi zostać widoczna mimo niesparowanych **')
  })

  it('puste linie oddzielaja bloki, nie generuja pustych akapitow', () => {
    const html = render('pierwszy akapit\n\n\ndrugi akapit')
    const akapity = html.match(/<p/g) ?? []
    assert.strictEqual(akapity.length, 2, `oczekiwano 2 akapitów, było: ${akapity.length}`)
  })

  it('lista zamyka sie przy napotkaniu zwyklej linii, nie polyka kolejnego akapitu', () => {
    const html = render('- punkt\nzwykly tekst po liscie')
    const ulIdx = html.indexOf('<ul')
    const closeIdx = html.indexOf('</ul>')
    const pIdx = html.indexOf('<p', closeIdx)
    assert.ok(ulIdx >= 0 && closeIdx > ulIdx && pIdx > closeIdx, 'lista nie zamknela sie przed akapitem')
  })

  it('pusty tekst nie wywala renderowania', () => {
    assert.strictEqual(render(''), '<div></div>')
  })
})
