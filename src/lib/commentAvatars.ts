/**
 * Zdjęcie autora przy komentarzu w szufladzie.
 *
 * Komentarz w ClickUpie nie wie, kto z portalu go napisał: autorem każdego jest
 * nasze konto serwisowe, a tożsamość klienta siedzi w prefiksie treści jako
 * NAZWA („(Łukasz Ślusarski) treść"), nie identyfikator. Trasa `/api/avatar`
 * potrzebuje `userId`, więc ktoś musi przejść z nazwy na konto i tu się to
 * dzieje: po stronie serwera, na liście kont TEGO portalu.
 *
 * Dopasowanie jest po nazwie i dlatego świadomie ostrożne:
 *   - porównujemy bez wielkości liter i bez nadmiarowych spacji, bo nazwa
 *     przechodzi przez treść komentarza, gdzie łatwo o drugą spację,
 *   - nazwa niejednoznaczna (dwoje kont o tej samej nazwie) NIE dostaje
 *     zdjęcia. Wolimy inicjały niż cudzą twarz przy czyimś komentarzu,
 *   - dokładne trafienie w pełną nazwę wygrywa z trafieniem po imieniu,
 *     bo prefiks bywa skrócony do imienia, a imiona się powtarzają.
 *
 * Zwracamy identyfikator wyłącznie dla kont, KTÓRE MAJĄ zdjęcie. Inaczej
 * przeglądarka strzelałaby w 404 przy każdym komentarzu każdej osoby bez
 * zdjęcia, a szuflada pokazywałaby pustą dziurę zamiast inicjałów.
 */

/** Konto portalu, które ma wgrane zdjęcie. Tyle wystarczy do dopasowania. */
export type AvatarOwner = {
  id: string
  name: string | null
}

const znormalizuj = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Mapa „nazwa autora → konto ze zdjęciem", gotowa do wielokrotnego pytania.
 *
 * Budujemy ją raz na wątek, bo w rozmowie ta sama osoba wraca w wielu
 * komentarzach, a lista kont portalu jest krótka.
 */
export function buildAvatarIndex(owners: readonly AvatarOwner[]): Map<string, string | null> {
  const pelne = new Map<string, string | null>()
  const imiona = new Map<string, string | null>()

  for (const o of owners) {
    if (!o.name) continue
    const pelna = znormalizuj(o.name)
    if (!pelna) continue
    // `null` znaczy „nazwa niejednoznaczna": drugie konto o tej samej nazwie
    // wyłącza zdjęcie dla obu, zamiast dawać pierwsze z listy.
    pelne.set(pelna, pelne.has(pelna) ? null : o.id)

    const imie = pelna.split(' ')[0]
    if (imie && imie !== pelna) {
      imiona.set(imie, imiona.has(imie) ? null : o.id)
    }
  }

  // Imiona wchodzą pod spód: pełna nazwa zawsze wygrywa.
  const index = new Map<string, string | null>(imiona)
  for (const [k, v] of pelne) index.set(k, v)
  return index
}

/** Konto ze zdjęciem dla podpisu autora, albo null gdy nie ma jednoznacznego. */
export function avatarUserIdForSender(
  index: Map<string, string | null>,
  sender: string | null | undefined,
): string | null {
  if (!sender) return null
  return index.get(znormalizuj(sender)) ?? null
}
