'use client'
import { useEffect, useState } from 'react'
import { Sun, Moon } from '@/lib/icons'
import {
  odczytajMotyw,
  przeciwny,
  rozstrzygnijMotyw,
  zastosujMotyw,
  KLASA_CIEMNA,
  MOTYW_KEY,
  type Motyw,
} from '@/lib/theme'

/**
 * Przełącznik motywu jasny/ciemny.
 *
 * Motyw nakłada na dokument skrypt z `layout.tsx`, JESZCZE PRZED pierwszym
 * malowaniem. Ten komponent go nie ustawia przy wejściu, tylko ODCZYTUJE stan
 * już nałożony i pozwala go zmienić. Gdyby ustawiał sam, w useEffect, to
 * działoby się po malowaniu i użytkownik ciemnego motywu widziałby białe
 * mignięcie przy każdym wejściu na stronę.
 *
 * HYDRACJA. Serwer nie wie, jaki motyw ma dany człowiek — to informacja
 * wyłącznie z jego przeglądarki. Dlatego do czasu zamontowania rysujemy
 * przycisk BEZ ikony, w tym samym rozmiarze. Zgadywanie ikony na serwerze
 * dawałoby rozjazd hydracji i mignięcie złej ikony.
 */
export function ThemeToggle() {
  const [motyw, setMotyw] = useState<Motyw | null>(null)

  useEffect(() => {
    // Stan bierzemy z DOKUMENTU, bo to on jest źródłem prawdy po skrypcie z
    // layoutu. Odczyt z `localStorage` dałby `null` dla kogoś, kto nigdy nie
    // klikał, i przycisk kłamałby o aktualnym wyglądzie strony.
    const zapisany = odczytajMotyw(bezpiecznyOdczyt())
    const naDokumencie = document.documentElement.classList.contains(KLASA_CIEMNA)
    /**
     * Reguła o `setState` w efekcie jest tu świadomie wyłączona, tak samo jak
     * w `NotificationBell`. Motyw jest informacją WYŁĄCZNIE z przeglądarki:
     * serwer go nie zna i znać nie może. Odczyt w inicjalizatorze `useState`
     * biegłby już przy pierwszym renderze po stronie klienta i dałby wynik inny
     * niż HTML z serwera, czyli rozjazd hydracji — dokładnie to, czego ten
     * efekt unika. Jeden dodatkowy render przy montowaniu jest ceną za brak
     * mignięcia złej ikony.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMotyw(rozstrzygnijMotyw(zapisany, naDokumencie))
  }, [])

  function przelacz() {
    const nowy = przeciwny(motyw ?? 'light')
    setMotyw(nowy)
    zastosujMotyw(nowy, document.documentElement)
    try {
      localStorage.setItem(MOTYW_KEY, nowy)
    } catch {
      // Tryb prywatny potrafi rzucić. Motyw i tak zadziała na tej karcie,
      // po prostu nie przeżyje odświeżenia — to lepsze niż błąd na ekranie.
    }
  }

  const ciemny = motyw === 'dark'

  return (
    <button
      type="button"
      onClick={przelacz}
      // Etykieta mówi, CO SIĘ STANIE po kliknięciu, nie jaki jest stan teraz.
      // „Motyw ciemny" przy włączonym ciemnym czytałoby się jak stan i nie
      // wiadomo by było, czy klikać.
      aria-label={ciemny ? 'Włącz motyw jasny' : 'Włącz motyw ciemny'}
      title={ciemny ? 'Włącz motyw jasny' : 'Włącz motyw ciemny'}
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {motyw === null ? (
        // Miejsce na ikonę do czasu zamontowania: bez tego przycisk skacze.
        <span className="block h-4 w-4" aria-hidden />
      ) : ciemny ? (
        <Sun className="h-4 w-4" aria-hidden />
      ) : (
        <Moon className="h-4 w-4" aria-hidden />
      )}
    </button>
  )
}

/** `localStorage` rzuca w trybie prywatnym niektórych przeglądarek. */
function bezpiecznyOdczyt(): string | null {
  try {
    return localStorage.getItem(MOTYW_KEY)
  } catch {
    return null
  }
}
