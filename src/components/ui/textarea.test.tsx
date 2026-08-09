// @vitest-environment jsdom
/**
 * Textarea rosnaca z trescia (zamiast recznego rozciagania), zgloszenie
 * Lukasza 2026-08-06: stale pole komentarza bylo za male, zeby widziec co
 * sie pisze.
 *
 * jsdom nie liczy prawdziwego layoutu, wiec `scrollHeight` jest zawsze 0.
 * Zamiast tego symulujemy realne zachowanie przegladarki: scrollHeight to
 * WIEKSZA z (1) wysokosci wynikajacej z tresci i (2) aktualnie ustawionej
 * jawnie wysokosci elementu, chyba ze ta wysokosc to `auto`. To odwzorowuje
 * prawdziwy mechanizm, ktory czyni resetowanie do `auto` PRZED odczytem
 * scrollHeight koniecznym: bez tego resetu pole raz rozciagniete nigdy by
 * sie nie skurczylo, bo jawna wysokosc sama podbijalaby kolejny odczyt.
 * Usuniecie linii `el.style.height = 'auto'` z komponentu wywali test
 * "wraca do minimum po wyczyszczeniu" ponizej.
 *
 *   npx vitest run src/components/ui/textarea.test.tsx
 */
import { describe, it, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, cleanup } from '@testing-library/react'
import { Textarea } from './textarea'

afterEach(cleanup)

function symulujScrollHeight() {
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      const zTresci = 24 + this.value.length * 2
      const jawna = this.style.height && this.style.height !== 'auto' ? parseInt(this.style.height, 10) : 0
      return Math.max(zTresci, jawna)
    },
  })
}

describe('Textarea — auto-wzrost z trescia', () => {
  it('rosnie, gdy tresc sie wydluza', () => {
    symulujScrollHeight()
    const Kontrolowana = ({ value }: { value: string }) => (
      <Textarea value={value} onChange={() => {}} />
    )

    const { rerender, container } = render(<Kontrolowana value="krotki tekst" />)
    const el = container.querySelector('textarea')!
    const naStart = parseInt(el.style.height, 10)

    rerender(<Kontrolowana value={'x'.repeat(200)} />)
    const poWydluzeniu = parseInt(el.style.height, 10)

    assert.ok(poWydluzeniu > naStart, `wysokosc powinna wzrosnac: ${naStart} -> ${poWydluzeniu}`)
  })

  it('wraca do minimum po wyczyszczeniu tresci (wysylka/anulowanie)', () => {
    symulujScrollHeight()
    const Kontrolowana = ({ value }: { value: string }) => (
      <Textarea value={value} onChange={() => {}} />
    )

    const { rerender, container } = render(<Kontrolowana value={'x'.repeat(300)} />)
    const el = container.querySelector('textarea')!
    const rozciagnieta = parseInt(el.style.height, 10)
    assert.ok(rozciagnieta > 100, 'test zakłada, że długa treść realnie rozciąga pole')

    // Dokladnie to robi handleSendComment/handleEditKeyDown po wyslaniu: czysci
    // stan kontrolujacy `value` na pusty string.
    rerender(<Kontrolowana value="" />)
    const poWyczyszczeniu = parseInt(el.style.height, 10)

    assert.ok(
      poWyczyszczeniu < rozciagnieta,
      `pole zostalo rozciagniete i NIE wrocilo do minimum: ${rozciagnieta}px -> ${poWyczyszczeniu}px`
    )
  })

  it('ma klasy odpowiedzialne za limit wysokosci i przewijanie zamiast reczengo rozciagania', () => {
    // Bez tego test powyzej mowilby tylko "rosnie w JS", a przegladarka i tak
    // pozwolilaby uzytkownikowi rozciagnac pole recznie (resize) albo rosnac
    // bez ograniczen (brak max-h), co dla dlugiego wklejonego tekstu rozepchaloby
    // cala szuflade zadania.
    symulujScrollHeight()
    const { container } = render(<Textarea value="cokolwiek" onChange={() => {}} />)
    const el = container.querySelector('textarea')!
    assert.ok(el.className.includes('max-h-64'), 'brak limitu wysokosci (max-h-64)')
    assert.ok(el.className.includes('overflow-y-auto'), 'brak przewijania po przekroczeniu limitu')
    assert.ok(el.className.includes('resize-none'), 'reczne rozciaganie powinno byc wylaczone na rzecz auto-wzrostu')
  })

  it('forwardRef dalej dziala: zewnetrzny ref dostaje prawdziwy wezel textarea', () => {
    // Kontrakt komponentu (React.forwardRef) latwo zepsuc przy takiej zmianie,
    // bo trzeba recznie polaczyc wewnetrzny ref (do pomiaru) z przekazanym.
    symulujScrollHeight()
    const zewnetrznyRef = vi.fn()
    render(<Textarea value="x" onChange={() => {}} ref={zewnetrznyRef} />)
    assert.strictEqual(zewnetrznyRef.mock.calls.length, 1)
    assert.ok(zewnetrznyRef.mock.calls[0][0] instanceof HTMLTextAreaElement)
  })
})
