// @vitest-environment jsdom
import { describe, it, beforeEach } from 'vitest'
import assert from 'node:assert'
import {
  odczytajMotyw,
  rozstrzygnijMotyw,
  przeciwny,
  zastosujMotyw,
  skryptMotywu,
  MOTYW_KEY,
  KLASA_CIEMNA,
} from '@/lib/theme'

/**
 * Motyw jasny/ciemny.
 *
 * Najwazniejsze sa tu dwie rzeczy, bo obie widac od razu i obie latwo zepsuc:
 *
 *   1. BRAK WYBORU to nie jest „jasny". Uzytkownik z ciemnym systemem ma dostac
 *      ciemny portal, zanim cokolwiek kliknie.
 *   2. Skrypt wstawiany do strony musi uzywac DOKLADNIE tego samego klucza i tej
 *      samej klasy co reszta modulu. Rozjazd znaczy, ze przelacznik zapisuje w
 *      jedno miejsce, a strona czyta z drugiego, i wybor „nie dziala" po
 *      odswiezeniu.
 *
 *   npx vitest run src/lib/theme.test.ts
 */

/**
 * Magazyn w pamieci, podstawiony pod `localStorage`.
 *
 * jsdom w tej konfiguracji nie daje dzialajacego `localStorage`
 * (`setItem is not a function`), a przedmiotem tych testow jest NASZ skrypt,
 * nie implementacja magazynu w przegladarce. Stub jest wiec zawezeniem pola
 * testu do rzeczy, ktora naprawde sprawdzamy.
 */
function podstawMagazyn() {
  const dane = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (dane.has(k) ? dane.get(k)! : null),
      setItem: (k: string, v: string) => { dane.set(k, String(v)) },
      removeItem: (k: string) => { dane.delete(k) },
      clear: () => { dane.clear() },
    },
  })
}

beforeEach(() => {
  podstawMagazyn()
  document.documentElement.classList.remove(KLASA_CIEMNA)
})

describe('odczytajMotyw', () => {
  it('przepuszcza tylko dwie znane wartosci', () => {
    assert.strictEqual(odczytajMotyw('light'), 'light')
    assert.strictEqual(odczytajMotyw('dark'), 'dark')
  })

  it('smiec w localStorage NIE wywala strony, tylko znaczy brak wyboru', () => {
    // localStorage jest wspoldzielony z innymi kartami i wersjami aplikacji,
    // wiec moze tam wyladowac cokolwiek.
    for (const smiec of ['DARK', 'ciemny', '', null, undefined, 0, {}, []]) {
      assert.strictEqual(odczytajMotyw(smiec), null, `nie powinno przejsc: ${JSON.stringify(smiec)}`)
    }
  })
})

describe('rozstrzygnijMotyw', () => {
  it('BRAK WYBORU idzie za systemem, w obie strony', () => {
    assert.strictEqual(rozstrzygnijMotyw(null, true), 'dark', 'ciemny system, ciemny portal')
    assert.strictEqual(rozstrzygnijMotyw(null, false), 'light')
  })

  it('wybor uzytkownika WYGRYWA z systemem', () => {
    // Inaczej ktos, kto swiadomie wybral jasny na ciemnym systemie, dostawalby
    // ciemny przy kazdym wejsciu i uznalby przelacznik za zepsuty.
    assert.strictEqual(rozstrzygnijMotyw('light', true), 'light')
    assert.strictEqual(rozstrzygnijMotyw('dark', false), 'dark')
  })
})

describe('przeciwny', () => {
  it('przelacza w obie strony', () => {
    assert.strictEqual(przeciwny('light'), 'dark')
    assert.strictEqual(przeciwny('dark'), 'light')
  })
})

describe('zastosujMotyw', () => {
  it('ciemny dokłada klase i ustawia color-scheme', () => {
    const root = document.createElement('html')

    zastosujMotyw('dark', root)

    assert.strictEqual(root.classList.contains(KLASA_CIEMNA), true)
    // color-scheme nie jest ozdoba: bez niego pasek przewijania i wnetrza
    // natywnych pol zostaja jasne w ciemnym motywie.
    assert.strictEqual(root.style.colorScheme, 'dark')
  })

  it('jasny ZDEJMUJE klase, nie tylko jej nie dodaje', () => {
    const root = document.createElement('html')
    root.classList.add(KLASA_CIEMNA)

    zastosujMotyw('light', root)

    assert.strictEqual(root.classList.contains(KLASA_CIEMNA), false)
    assert.strictEqual(root.style.colorScheme, 'light')
  })

  it('nie rusza pozostalych klas dokumentu', () => {
    // Na <html> siedza tez klasy fontu i `antialiased` z layoutu.
    const root = document.createElement('html')
    root.className = 'font-brand antialiased h-full'

    zastosujMotyw('dark', root)
    zastosujMotyw('light', root)

    for (const klasa of ['font-brand', 'antialiased', 'h-full']) {
      assert.ok(root.classList.contains(klasa), `zgubiona klasa: ${klasa}`)
    }
  })
})

describe('skryptMotywu', () => {
  it('uzywa TEGO SAMEGO klucza i klasy co reszta modulu', () => {
    // Sprawdzamy WARTOSC, nie sposob cytowania: skrypt wstawia je przez
    // JSON.stringify, wiec ida w cudzyslowach, a wczesniej szly w apostrofach.
    // Test zwiazany ze sposobem zapisu padalby przy nieszkodliwej zmianie.
    const skrypt = skryptMotywu()
    assert.ok(skrypt.includes(MOTYW_KEY), 'skrypt czyta inny klucz niz zapisuje przelacznik')
    assert.ok(skrypt.includes(KLASA_CIEMNA), 'skrypt ustawia inna klase niz style')
  })

  it('pyta o ustawienie systemu, gdy nic nie zapisano', () => {
    assert.ok(skryptMotywu().includes('prefers-color-scheme'))
  })

  it('BRAK matchMedia nie zjada zapisanego wyboru', () => {
    // Zlapane testem 25.08. Skrypt mial jeden wspolny `try`, wiec wyjatek z
    // `matchMedia` wywracal cale wyrazenie i przepadal razem z nim wybor
    // uzytkownika — awaria pytania o system kasowala decyzje, ktora z systemem
    // nie miala nic wspolnego. jsdom nie ma `matchMedia`, wiec odtwarza to
    // wiernie, bez udawania.
    assert.strictEqual(typeof window.matchMedia, 'undefined', 'jsdom nagle ma matchMedia, test stracil sens')

    localStorage.setItem(MOTYW_KEY, 'dark')
    document.documentElement.classList.remove(KLASA_CIEMNA)

    new Function(skryptMotywu())()

    assert.strictEqual(
      document.documentElement.classList.contains(KLASA_CIEMNA),
      true,
      'zapisany wybor musi zadzialac takze bez matchMedia'
    )
    localStorage.clear()
    document.documentElement.classList.remove(KLASA_CIEMNA)
  })

  it('jest odporny na wyjatek z localStorage', () => {
    // W trybie prywatnym niektorych przegladarek `localStorage` rzuca. Skrypt
    // stoi PRZED trescia strony, wiec jego wyjatek zatrzymalby renderowanie.
    assert.ok(skryptMotywu().includes('try'), 'skrypt bez try zablokuje strone')
    assert.ok(skryptMotywu().includes('catch'), 'skrypt bez catch zablokuje strone')
  })

  it('faktycznie USTAWIA ciemny, gdy tak zapisano (wykonany naprawde)', () => {
    // Sam napis moze wygladac dobrze i nie dzialac. Wykonujemy go na prawdziwym
    // dokumencie jsdom, tak jak zrobi to przegladarka.
    //
    // `new Function` jest tu bezpieczne i NIE jest wzorcem do kopiowania:
    // wejsciem jest wylacznie nasz wlasny napis zlozony ze stalych modulu,
    // zero danych z zewnatrz. W kodzie produkcyjnym tego nie ma i byc nie moze.
    localStorage.setItem(MOTYW_KEY, 'dark')
    document.documentElement.classList.remove(KLASA_CIEMNA)

    new Function(skryptMotywu())()

    assert.strictEqual(document.documentElement.classList.contains(KLASA_CIEMNA), true)
    localStorage.clear()
  })

  it('faktycznie ZDEJMUJE ciemny, gdy zapisano jasny', () => {
    localStorage.setItem(MOTYW_KEY, 'light')
    document.documentElement.classList.add(KLASA_CIEMNA)

    new Function(skryptMotywu())()

    assert.strictEqual(document.documentElement.classList.contains(KLASA_CIEMNA), false)
    localStorage.clear()
  })
})
