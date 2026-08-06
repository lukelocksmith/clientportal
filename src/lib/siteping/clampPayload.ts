/**
 * Godzi widget SitePinga z jego wlasnym adapterem serwerowym.
 *
 * DLACZEGO TO ISTNIEJE (potwierdzone empirycznie, nie z dokumentacji):
 * `@siteping/widget` 0.10.7 liczy prostokat zaznaczenia WZGLEDEM zakotwiczonego
 * elementu, wiec gdy uzytkownik przeciagnie myszka poza jego krawedzie — co jest
 * zwyklym, codziennym gestem, zwlaszcza gdy kotwica wypadnie na niski element
 * albo na `body` — wysyla ulamki spoza [0,1]. Realny payload z takiej sesji:
 * `hPct: 1.6064545047064096`.
 *
 * `@siteping/adapter-prisma` 0.6.4 waliduje te same pola jako `[0,1]` i odrzuca
 * cale zgloszenie z HTTP 400:
 *   {"errors":[{"field":"annotations.0.rect.hPct","message":"Too big: expected number to be <=1"}]}
 *
 * Widget NIE POKAZUJE tego bledu uzytkownikowi — chowa zgloszenie do kolejki
 * ponawiania w `localStorage` i bije nim w serwer w kolko. Z perspektywy klienta
 * „przycisk Wyslij nic nie robi", a w ClickUpie nie pojawia sie nic. Bez tej
 * warstwy funkcja jest nieuzywalna dla czesci gestow i psuje sie po cichu.
 *
 * Przycinamy zamiast odrzucac, bo przyciecie jest semantycznie tym samym, co
 * zrobil uzytkownik: zaznaczenie wychodzace poza element oznacza „ten element",
 * a nie „inny obszar". Dane pozycji sluza wskazaniu miejsca czlowiekowi, nie
 * pomiarom — utrata ulamka poza krawedzia niczego nie zmienia, a odrzucenie
 * zgloszenia kosztuje klienta cala tresc, ktora wlasnie napisal.
 *
 * Czysty modul: bez sieci, bez bazy, bez Next.
 */

/** Ulamek [0,1]; wartosci spoza zakresu i NaN sprowadzone do najblizszej granicy. */
function clampFraction(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

/** Liczba nieujemna; `scrollX/scrollY` potrafia byc ujemne przy odbiciu (bounce scroll) na macOS. */
function clampNonNegative(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, value)
}

/** Dodatnia liczba calkowita — schemat adaptera wymaga tego od `viewportW/H`. */
function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.round(value))
}

/** Dodatni mnoznik; `devicePixelRatio` = 0 zdarza sie na czesci zdalnych pulpitow. */
function clampPositive(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Sprowadza liczby w anotacjach do zakresow, ktorych wymaga adapter.
 *
 * Pola NIELICZBOWE (selektor, xpath, tekst) zostaja nietkniete — to one niosa
 * informacje o miejscu zmiany i nie wolno ich „naprawiac". Payload, ktory nie ma
 * anotacji albo nie jest obiektem, wraca bez zmian: walidacja adaptera i tak go
 * oceni, a my nie zgadujemy za nia.
 */
export function clampAnnotationRanges<T>(payload: T): T {
  if (!isRecord(payload) || !Array.isArray(payload.annotations)) return payload

  const annotations = payload.annotations.map(annotation => {
    if (!isRecord(annotation)) return annotation

    const next: Record<string, unknown> = { ...annotation }

    if (isRecord(annotation.rect)) {
      const rect = annotation.rect
      next.rect = {
        ...rect,
        xPct: clampFraction(rect.xPct, 0),
        yPct: clampFraction(rect.yPct, 0),
        wPct: clampFraction(rect.wPct, 0),
        hPct: clampFraction(rect.hPct, 0),
      }
    }

    next.scrollX = clampNonNegative(annotation.scrollX, 0)
    next.scrollY = clampNonNegative(annotation.scrollY, 0)
    next.viewportW = clampPositiveInt(annotation.viewportW, 1)
    next.viewportH = clampPositiveInt(annotation.viewportH, 1)
    next.devicePixelRatio = clampPositive(annotation.devicePixelRatio, 1)

    return next
  })

  return { ...payload, annotations } as T
}
