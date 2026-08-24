// @vitest-environment jsdom
import { describe, it, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'

/**
 * Podglad renderowania komentarza, strona TYLKO DEWELOPERSKA.
 *
 * Po co istnieje: formatowanie komentarzy (obrazki, tabele, listy, kod, wideo)
 * nie da sie przekliknac na prawdziwych danych, bo zaden komentarz oznaczony
 * jako publiczny takiego formatowania jeszcze nie ma. Bez tej strony jedynym
 * sposobem obejrzenia go byloby dopisanie komentarza w ClickUpie klienta.
 *
 * Najwazniejszy test w tym pliku to ten o produkcji: strona pokazuje przyklady
 * na sztywno wpisane w kod i nie ma prawa istniec na portalu klienta.
 *
 *   npx vitest run src/app/admin/podglad-komentarza/page.test.tsx
 */
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('next/navigation', () => ({ notFound }))

import PodgladKomentarza from './page'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('brama produkcji', () => {
  it('na produkcji strony NIE MA', () => {
    vi.stubEnv('NODE_ENV', 'production')

    // Licznik wywolan, nie rowno jeden: React ponawia render po wyjatku, wiec
    // `notFound()` pada kilka razy. Liczy sie to, ze pada i ze nic nie wyszlo.
    assert.throws(() => render(<PodgladKomentarza />), /NEXT_NOT_FOUND/)
    assert.ok(notFound.mock.calls.length >= 1, 'brama nie zadziala')
    assert.strictEqual(screen.queryByRole('heading') === null, true, 'strona nie ma prawa sie wyrenderowac')
  })

  it('lokalnie strona sie renderuje', () => {
    vi.stubEnv('NODE_ENV', 'development')

    render(<PodgladKomentarza />)

    assert.strictEqual(notFound.mock.calls.length, 0)
  })
})

describe('co pokazuje podglad', () => {
  function pokaz() {
    vi.stubEnv('NODE_ENV', 'development')
    return render(<PodgladKomentarza />)
  }

  it('wzmianka o zadaniu Z portalu jest linkiem z nazwa', () => {
    pokaz()

    const link = screen.getByRole('link', { name: /Drobne poprawki/ })
    assert.match(link.getAttribute('href') ?? '', /\?task=/)
  })

  it('wzmianka o zadaniu SPOZA portalu nie pokazuje nazwy', () => {
    pokaz()

    assert.ok(screen.getByText(/inne zadanie/i))
  })

  it('pokazuje obrazek, plik i wideo', () => {
    const { container } = pokaz()

    assert.ok(screen.getByRole('img'), 'brak obrazka')
    assert.ok(screen.getByRole('link', { name: /\.pdf/ }), 'brak pliku')
    assert.ok(container.querySelector('video'), 'brak wideo')
  })

  it('pokazuje liste, blok kodu, cytat i tabele', () => {
    const { container } = pokaz()

    assert.ok(screen.getAllByRole('listitem').length > 0, 'brak listy')
    assert.ok(container.querySelector('pre'), 'brak bloku kodu')
    assert.ok(container.querySelector('blockquote'), 'brak cytatu')
    assert.ok(screen.getAllByRole('columnheader').length > 0, 'brak tabeli')
  })

  it('oznaczenie osoby z zespolu NIE pojawia sie na podgladzie', () => {
    // Podglad ma pokazywac to, co widzi klient. Wzmianka o osobie wypada w
    // `publicCommentBlocks`, wiec gdyby tu byla, podglad by klamal.
    pokaz()

    assert.strictEqual(screen.queryByText(/Paulina/) === null, true, 'wzmianka o osobie na podgladzie')
  })

  it('pokazuje pogrubienie, kursywe i kod w linii', () => {
    const { container } = pokaz()

    assert.ok(container.querySelector('strong'), 'brak pogrubienia')
    assert.ok(container.querySelector('em'), 'brak kursywy')
    assert.ok(container.querySelector('code'), 'brak kodu w linii')
  })
})
