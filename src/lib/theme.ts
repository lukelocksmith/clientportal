/**
 * Motyw jasny/ciemny.
 *
 * Paleta ciemna (`.dark` w globals.css) istniała w portalu od początku, ale NIC
 * jej nigdy nie włączało — była martwym kodem do 2026-08-25. Ten moduł jest tym
 * brakującym przełącznikiem.
 *
 * CZYSTE funkcje plus jedna dotykająca DOM, bo cała trudność tej funkcji siedzi
 * w dwóch miejscach i oba da się sprawdzić testem: co robimy z zapisaną
 * wartością, której nie rozumiemy, i czy przełączenie faktycznie zmienia klasę
 * na dokumencie.
 */

export type Motyw = 'light' | 'dark'

/**
 * Klucz w `localStorage`. Stała, bo używa go TAKŻE skrypt wstawiany do strony
 * (layout.tsx), który musi ustawić motyw przed pierwszym malowaniem. Dwie kopie
 * tego napisu znaczyłyby, że przełącznik zapisuje w jedno miejsce, a skrypt
 * czyta z drugiego, i motyw wracałby do domyślnego przy każdym wejściu.
 */
export const MOTYW_KEY = 'motyw'

/** Klasa włączająca ciemną paletę. Ta sama, którą rozumie `dark:` w Tailwindzie. */
export const KLASA_CIEMNA = 'dark'

/**
 * Zapisana wartość na motyw, albo `null`, gdy nic sensownego nie zapisano.
 *
 * `null` NIE znaczy „jasny": znaczy „nie wybrano", czyli idziemy za systemem.
 * To rozróżnienie jest całym sensem tej funkcji — bez niego użytkownik z
 * ciemnym systemem dostawałby jasny portal, dopóki sam by nie kliknął.
 */
export function odczytajMotyw(raw: unknown): Motyw | null {
  return raw === 'light' || raw === 'dark' ? raw : null
}

/** Motyw do pokazania: wybór użytkownika, a gdy go nie ma — ustawienie systemu. */
export function rozstrzygnijMotyw(zapisany: Motyw | null, systemCiemny: boolean): Motyw {
  return zapisany ?? (systemCiemny ? 'dark' : 'light')
}

export function przeciwny(motyw: Motyw): Motyw {
  return motyw === 'dark' ? 'light' : 'dark'
}

/**
 * Nakłada motyw na dokument.
 *
 * Dwie rzeczy naraz, bo sama klasa nie wystarcza: `color-scheme` mówi
 * przeglądarce, jak pomalować rzeczy, których nie stylujemy — paski przewijania,
 * natywne pola formularzy, okna wyboru daty. Bez tego w ciemnym motywie zostaje
 * jasny pasek przewijania i białe wnętrza inputów.
 */
export function zastosujMotyw(motyw: Motyw, root: HTMLElement): void {
  root.classList.toggle(KLASA_CIEMNA, motyw === 'dark')
  root.style.colorScheme = motyw
}

/**
 * Skrypt ustawiający motyw PRZED pierwszym malowaniem strony.
 *
 * Bez niego strona zawsze zaczyna jasna i dopiero React po hydracji przełącza
 * ją na ciemną — czyli użytkownik ciemnego motywu dostaje białe mignięcie przy
 * każdym wejściu. Tego nie da się naprawić z komponentu, bo komponent działa
 * już po malowaniu.
 *
 * Skrypt jest zbudowany Z TYCH SAMYCH stałych, co reszta modułu, więc klucz i
 * nazwa klasy nie mogą się rozjechać. Cały w `try`, bo `localStorage` rzuca
 * wyjątkiem w trybie prywatnym niektórych przeglądarek, a mignięcie motywu jest
 * mniejszym problemem niż wywrócony skrypt blokujący stronę.
 */
export function skryptMotywu(): string {
  /**
   * TRZY osobne `try`, nie jeden wspólny. Wspólny wyglądał zwięźlej i miał
   * realną wadę, którą złapał test: gdy `matchMedia` było niedostępne, wyjątek
   * wywracał CAŁE wyrażenie i przepadał razem z nim ZAPISANY WYBÓR użytkownika.
   * Czyli awaria pytania o system kasowała decyzję, która z systemem nie miała
   * nic wspólnego.
   *
   * Teraz każdy krok broni się sam: nieczytelny magazyn znaczy „brak wyboru",
   * niedostępne `matchMedia` znaczy „nie wiem, co ma system", a nałożenie
   * motywu dzieje się i tak.
   */
  /**
   * JEDEN literał, bez sklejania `+`, i wartości wstawiane przez
   * `JSON.stringify`.
   *
   * To nie jest kwestia stylu. Wcześniej ten skrypt był składany z ośmiu
   * kawałków przez `+` i minifikator produkcyjny ZGUBIŁ jego środek: do
   * przeglądarki docierał urwany kod, który wywalał się na `missing ) after
   * argument list`, więc motyw w ogóle się nie ustawiał. Testy jednostkowe tego
   * NIE widzą, bo one wołają funkcję ze źródła, a psuło się dopiero przy
   * budowaniu (znalezione 25.08 przez sprawdzenie w przeglądarce na buildzie
   * produkcyjnym, nie w trybie deweloperskim).
   *
   * `JSON.stringify` zamiast ręcznych apostrofów: cudzysłowy są wtedy
   * poprawnie zacytowane niezależnie od tego, co siedzi w stałej.
   */
  return `(function(){var z=null;try{z=localStorage.getItem(${JSON.stringify(MOTYW_KEY)})}catch(e){}var c=z==='dark';if(z!=='dark'&&z!=='light'){try{c=matchMedia('(prefers-color-scheme: dark)').matches}catch(e){}}try{var r=document.documentElement;r.classList.toggle(${JSON.stringify(KLASA_CIEMNA)},c);r.style.colorScheme=c?'dark':'light'}catch(e){}})()`
}
