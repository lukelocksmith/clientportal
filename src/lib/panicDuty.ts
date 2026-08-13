/**
 * Osoba dyżurna alarmu: ta, która dostaje zadanie awaryjne od razu przy
 * wciśnięciu czerwonego przycisku.
 *
 * Zmienna środowiskowa, a nie stała w kodzie, bo zmiana dyżuru (urlop, zmiana
 * ról w zespole) nie może wymagać deployu. Zapas to identyfikator Pauliny
 * w workspace klientów (4552118), zgodnie z ustaleniem z 2026-08-13.
 *
 * Wartość `0` albo pusta wyłącza automatyczne przypisywanie: zadanie powstaje
 * bez właściciela, a eskalacja traktuje wtedy KAŻDEGO przypisanego jako
 * „ktoś inny", bo nie ma osoby, którą należałoby pominąć.
 */
const PAULINA_CLICKUP_ID = 94729587

export function dutyAssigneeId(): number | null {
  const raw = process.env.PANIC_ASSIGNEE_CLICKUP_ID
  if (raw === undefined) return PAULINA_CLICKUP_ID
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

/** Wygodny alias dla miejsc, które czytają wartość raz, w czasie żądania. */
export const DUTY_ASSIGNEE_ID = dutyAssigneeId
