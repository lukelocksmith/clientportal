/**
 * Odmiana rzeczownika po liczbie, po polsku.
 *
 * Powstało, bo trzy miejsca w kodzie składały odmianę na piechotę i wszystkie
 * trzy były błędne:
 *
 * 1. `'użytkownik' + (n < 5 ? 'i' : 'ów')` dawało „2 użytkowniki". Doklejanie
 *    końcówki nie działa, gdy zmienia się rdzeń (użytkownik → użytkownicy).
 * 2. Warunek `n < 5` jest zły powyżej 20. Polski bierze formę mnogą „kilku"
 *    dla liczb kończących się na 2, 3, 4, ALE NIE dla 12, 13, 14. Więc jest
 *    „22 zgłoszenia" i „12 zgłoszeń", a warunek `< 5` dawał w obu „zgłoszeń".
 *
 * Podajemy trzy pełne formy, nie rdzeń i końcówki, właśnie z powodu punktu 1.
 */
export type PluralForms = {
  /** 1 zgłoszenie */
  one: string
  /** 2, 3, 4, 22, 23, 24 zgłoszenia */
  few: string
  /** 0, 5..21, 25.. zgłoszeń */
  many: string
}

export function pluralForm(count: number, forms: PluralForms): string {
  const n = Math.abs(Math.trunc(count))
  if (n === 1) return forms.one

  const lastTwo = n % 100
  const last = n % 10
  // 12, 13, 14 to wyjątek: mimo końcówki 2/3/4 biorą formę „many".
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return forms.few

  return forms.many
}

/** Liczba razem z odmienionym rzeczownikiem, np. „2 użytkownicy". */
export function plural(count: number, forms: PluralForms): string {
  return `${count} ${pluralForm(count, forms)}`
}

// Formy używane w więcej niż jednym miejscu. Trzymane tutaj, żeby nie
// rozjechały się między widokami.
export const USERS: PluralForms = {
  one: 'użytkownik',
  few: 'użytkownicy',
  many: 'użytkowników',
}

export const REQUESTS: PluralForms = {
  one: 'zgłoszenie',
  few: 'zgłoszenia',
  many: 'zgłoszeń',
}

export const SUBTASKS: PluralForms = {
  one: 'podzadanie',
  few: 'podzadania',
  many: 'podzadań',
}

export const HOURS_LOCATIVE: PluralForms = {
  // Miejscownik, bo używane po przyimku „po": „po 1 godzinie", „po 2 godzinach".
  one: 'godzinie',
  few: 'godzinach',
  many: 'godzinach',
}
