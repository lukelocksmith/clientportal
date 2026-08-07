/**
 * Czas względny po polsku: „5 minut temu", „wczoraj", „3 dni temu".
 *
 * CZYSTY moduł, `now` wstrzykiwane, więc daje się sprawdzić bez zamrażania
 * zegara. Osobno od `formatDate` w utils.ts, bo odpowiada na inne pytanie:
 * `formatDate` mówi KIEDY coś było („12 sie"), a to mówi JAK DAWNO. Na liście
 * powiadomień liczy się to drugie — „12 sie" przy powiadomieniu sprzed godziny
 * każe czytelnikowi liczyć w pamięci, czy to dziś.
 *
 * Polska odmiana liczebników jest tu zrobiona jawnie, a nie przez `Intl`:
 * `Intl.RelativeTimeFormat` daje „5 minut temu" poprawnie, ale nie zna form
 * „wczoraj" ani progu, po którym lepiej pokazać zwykłą datę.
 */

/** Poprawna forma rzeczownika dla liczby: 1 / 2-4 / 5+ z wyjątkami 12-14. */
function odmien(n: number, jeden: string, kilka: string, wiele: string): string {
  if (n === 1) return jeden
  const dziesiatki = n % 100
  const jednosci = n % 10
  // 12, 13, 14 biorą formę mnogą mimo końcówki 2-4 — stąd wyłączenie 12-14.
  if (jednosci >= 2 && jednosci <= 4 && !(dziesiatki >= 12 && dziesiatki <= 14)) return kilka
  return wiele
}

/**
 * Opis „jak dawno", albo zwykła data dla zdarzeń starszych niż tydzień.
 *
 * Po tygodniu czas względny przestaje pomagać: „za 23 dni temu" wymaga od
 * czytelnika tego samego liczenia, co data, tylko w drugą stronę.
 *
 * Zdarzenia z PRZYSZŁOŚCI (rozjazd zegarów między serwerem a przeglądarką)
 * pokazujemy jako „przed chwilą", a nie „za 3 minuty": powiadomienie o czymś,
 * co jeszcze się nie stało, wygląda na awarię, a jest zwykłą różnicą zegarów.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const kiedy = new Date(iso)
  if (Number.isNaN(kiedy.getTime())) return ''

  const sekundy = Math.floor((now.getTime() - kiedy.getTime()) / 1000)

  if (sekundy < 60) return 'przed chwilą'

  const minuty = Math.floor(sekundy / 60)
  if (minuty < 60) return `${minuty} ${odmien(minuty, 'minutę', 'minuty', 'minut')} temu`

  const godziny = Math.floor(minuty / 60)
  if (godziny < 24) return `${godziny} ${odmien(godziny, 'godzinę', 'godziny', 'godzin')} temu`

  const dni = Math.floor(godziny / 24)
  if (dni === 1) return 'wczoraj'
  if (dni < 7) return `${dni} ${odmien(dni, 'dzień', 'dni', 'dni')} temu`

  return kiedy.toLocaleDateString('pl-PL', {
    day: 'numeric',
    month: 'short',
    ...(kiedy.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/** Pełna data i godzina, pod atrybut `title`. Względny czas bywa za ogólny. */
export function exactTime(iso: string): string {
  const kiedy = new Date(iso)
  if (Number.isNaN(kiedy.getTime())) return ''
  return kiedy.toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
