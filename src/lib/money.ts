/**
 * Kwoty w raporcie czasu pracy.
 *
 * CZYSTY moduł, bez bazy i bez sieci, bo to jest liczba, którą klient zobaczy
 * obok faktury — najtaniej i najpewniej sprawdzić ją testem.
 *
 * DWIE ZASADY, z których wynika cała reszta:
 *
 * 1. **Grosze, nie złotówki zmiennoprzecinkowe.** `0.1 + 0.2` w JavaScripcie
 *    nie równa się `0.3`, a przy sumowaniu godzin razy stawka ten błąd rośnie.
 *    Liczymy więc na liczbach całkowitych i dzielimy dopiero przy wyświetlaniu.
 *
 * 2. **Stawka jest NETTO**, tak samo jak w CRM (Notion, baza „B: PROJEKT",
 *    kolumna `Godzinówka`). Brutto liczy się tam jako +23% i portal go NIE
 *    pokazuje: raport leży obok faktury, na której VAT jest osobną pozycją,
 *    a jedna stawka VAT wpisana na sztywno kłamałaby przy kliencie
 *    rozliczanym inaczej.
 */

const MS_W_GODZINIE = 60 * 60 * 1000

/**
 * Kwota netto w groszach za dany czas.
 *
 * Zaokrąglamy RAZ, na samym końcu, do pełnego grosza. Zaokrąglanie po drodze
 * (np. do pełnych złotych za każdą pozycję) rozjeżdżałoby sumę z fakturą.
 *
 * `null` gdy stawki nie znamy — i to jest ODPOWIEDŹ, nie błąd. Portal ma wtedy
 * pokazać same godziny. Zgadnięta kwota przy fakturze jest gorsza niż jej brak.
 */
export function kwotaNettoGrosze(ms: number, stawkaNettoGrosze: number | null): number | null {
  if (stawkaNettoGrosze == null || !Number.isFinite(stawkaNettoGrosze)) return null
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round((ms / MS_W_GODZINIE) * stawkaNettoGrosze)
}

/**
 * Kwota po polsku: „1 234,50 zł".
 *
 * Spacja nierozdzielająca między liczbą a „zł" i w tysiącach, żeby kwota nigdy
 * nie łamała się na dwie linie w wąskiej kolumnie.
 */
export function formatujZl(grosze: number): string {
  const zl = grosze / 100
  const tekst = new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(zl)
  // Intl dla pl-PL daje wąską spację nierozdzielającą w tysiącach; dokładamy
  // taką samą przed jednostką, żeby całość trzymała się razem.
  return `${tekst} zł`
}

/**
 * Stawka godzinowa do podpisu pod kwotą.
 *
 * Pełne złote bez końcówki, gdy stawka jest okrągła (140 zł, nie 140,00 zł):
 * to podpis pomocniczy, a nie pozycja rozliczeniowa, więc ma być czytelny
 * jednym rzutem oka.
 */
export function formatujStawke(stawkaNettoGrosze: number): string {
  const rowne = stawkaNettoGrosze % 100 === 0
  const zl = stawkaNettoGrosze / 100
  const tekst = rowne
    ? new Intl.NumberFormat('pl-PL').format(zl)
    : new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(zl)
  return `${tekst} zł/h`
}

/**
 * Stawka podana przez człowieka (w złotych) na grosze do zapisu.
 *
 * Przyjmuje liczbę i tekst, bo przez API leci JSON, a z formularza tekst,
 * w którym przecinek dziesiętny jest w Polsce naturalny. Odrzuca wartości
 * ujemne i bezsensowne: stawka `-50` zamieniłaby raport w ujemną kwotę.
 *
 * `null` znaczy „wyczyść stawkę", czyli świadomy brak, i jest wartością
 * poprawną — inaczej nie dałoby się cofnąć raz wpisanej stawki.
 */
export function stawkaNaGrosze(raw: unknown): number | null {
  if (raw === null || raw === '') return null
  const tekst = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null
  if (tekst === null || tekst === '') return null

  const liczba = Number(tekst.replace(',', '.').replace(/\s/g, ''))
  if (!Number.isFinite(liczba) || liczba < 0) return null

  return Math.round(liczba * 100)
}
