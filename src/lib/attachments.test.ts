import { describe, it, expect } from 'vitest'
import { fileNameOf, isInternalFile, visibleAttachments } from './attachments'

describe('fileNameOf', () => {
  it('wyciąga nazwę z adresu z parametrami', () => {
    expect(fileNameOf('https://t.clickup.com/123/_notatka.png?signature=abc')).toBe('_notatka.png')
  })

  it('rozkodowuje spacje z adresu', () => {
    expect(fileNameOf('https://t.clickup.com/123/_zrzut%20ekranu.png')).toBe('_zrzut ekranu.png')
  })
})

describe('isInternalFile', () => {
  it('podkreślenie na początku znaczy wewnętrzny', () => {
    expect(isInternalFile('_plik.txt')).toBe(true)
    expect(isInternalFile(' _plik.txt')).toBe(true)
  })

  it('podkreślenie w środku nazwy niczego nie ukrywa', () => {
    expect(isInternalFile('raport_2026.pdf')).toBe(false)
    expect(isInternalFile('umowa.pdf')).toBe(false)
  })

  it('brak nazwy to plik widoczny, nie ukryty', () => {
    expect(isInternalFile(null)).toBe(false)
    expect(isInternalFile(undefined)).toBe(false)
  })
})

describe('visibleAttachments', () => {
  it('usuwa wewnętrzne, zachowuje kolejność pozostałych', () => {
    const lista = [
      { title: 'oferta.pdf' },
      { title: '_wersja-robocza.pdf' },
      { title: 'zrzut.png' },
    ]
    expect(visibleAttachments(lista)).toEqual([{ title: 'oferta.pdf' }, { title: 'zrzut.png' }])
  })

  it('gdy nazwy nie ma, rozstrzyga adres', () => {
    expect(visibleAttachments([{ url: 'https://t.clickup.com/9/_tajne.png' }])).toEqual([])
  })

  it('brak załączników to pusta lista, nie wyjątek', () => {
    expect(visibleAttachments(undefined)).toEqual([])
  })
})
