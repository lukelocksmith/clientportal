/**
 * DŁAWIENIE ALARMÓW: ten sam problem budzi zespół raz, nie sto razy.
 *
 * PO CO (14.09). Kanał alarmów zespołu jest wspólny dla czerwonego przycisku
 * klienta i dla awarii portalu, więc jego wartość zależy od tego, czy da się
 * go czytać. Dzień wcześniej moja własna seria pomiarów wysłała tam czternaście
 * wiadomości pod rząd i zamieniła kanał w szum; błąd 5xx w pętli zrobiłby to
 * samo, tylko szybciej i bez niczyjej wiedzy.
 *
 * Reguła jest prosta: pierwszy alarm z danym kluczem przechodzi, kolejne z tym
 * samym kluczem milczą, dopóki nie minie okno. Po oknie znów przechodzi jeden,
 * więc trwający problem przypomina o sobie regularnie, zamiast zniknąć.
 *
 * STAN SIEDZI W PAMIĘCI PROCESU, świadomie. Baza byłaby trwalsza, ale wtedy
 * awaria bazy uciszałaby alarmy o awarii bazy. Restart kontenera przepuszcza
 * jeden alarm więcej i to jest właściwa strona pomyłki.
 */

/** Okno ciszy dla tego samego klucza. */
export const OKNO_MS = 30 * 60 * 1000

/**
 * Ile różnych kluczy pamiętamy. Powyżej tego czyścimy wpisy najstarsze:
 * pamięć procesu ma być stała, a nie rosnąć z liczbą wariantów błędu, którą
 * podpowiada atakujący albo zepsuta pętla.
 */
const MAX_KLUCZY = 500

const ostatnie = new Map<string, number>()

/**
 * Czy wolno teraz wysłać alarm o tym kluczu.
 *
 * Zwraca `true` DOKŁADNIE RAZ na okno i od razu zapisuje decyzję, więc dwa
 * równoległe wywołania nie przepuszczą dwóch alarmów.
 */
export function wolnoAlarmowac(klucz: string, teraz: number = Date.now()): boolean {
  const poprzedni = ostatnie.get(klucz)
  if (poprzedni !== undefined && teraz - poprzedni < OKNO_MS) return false

  if (ostatnie.size >= MAX_KLUCZY) {
    const najstarszy = [...ostatnie.entries()].sort((a, b) => a[1] - b[1])[0]
    if (najstarszy) ostatnie.delete(najstarszy[0])
  }
  ostatnie.set(klucz, teraz)
  return true
}

/** Czyści pamięć dławienia. Do testów; w działającym portalu nie ma wołającego. */
export function zapomnijDlawienie(): void {
  ostatnie.clear()
}
