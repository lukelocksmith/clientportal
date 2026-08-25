/**
 * Profil użytkownika portalu: imię, hasło, zdjęcie. CZYSTY moduł.
 *
 * Bez bazy, bez Next, bez `node:crypto`. Importuje go ZARAZEM przeglądarka
 * (formularze profilu, skalowanie zdjęcia) i serwer (trasy `/api/profile`,
 * `/api/avatar`), więc jedna zależność serwerowa tutaj wciągnęłaby ją do
 * paczki przeglądarki. Tą drogą sterownik postgresa położył kiedyś całą
 * aplikację, a `tsc` tego nie widzi.
 *
 * Podział jest też merytoryczny: te same reguły muszą obowiązywać po obu
 * stronach. Przeglądarka blokuje przycisk, żeby nie wysyłać czegoś, co i tak
 * zostanie odrzucone; serwer sprawdza wszystko drugi raz, bo przeglądarka nie
 * jest granicą bezpieczeństwa. Jeden moduł znaczy, że te dwa sprawdzenia nie
 * mają jak się rozjechać.
 */

/**
 * Minimum długości hasła. TAKIE SAMO jak w `/api/auth/set-password`.
 *
 * Gdyby profil wymagał mniej, klient ustawiłby tu hasło, którego nie da się
 * powtórzyć przy odzyskiwaniu dostępu z linku, i uznałby, że to tamten
 * formularz jest zepsuty.
 */
export const MIN_PASSWORD_LENGTH = 10

/** Limit imienia. Zgodny z tym, co przyjmuje trasa admina przy zakładaniu konta. */
export const MAX_NAME_LENGTH = 100

/** Bok awatara po przeskalowaniu w przeglądarce. */
export const AVATAR_SIZE = 256

/**
 * Twardy limit zapisu `avatar_url`, liczony na DATA URI, nie na pliku.
 *
 * 256×256 WebP z jakością 0.85 waży realnie 8–20 kB, po zakodowaniu base64
 * około jedną trzecią więcej. 64 kB zostawia zapas na format zapasowy (JPEG)
 * i na zdjęcia, które kompresują się źle, a wciąż odcina wszystko, co nie
 * przeszło przez nasze skalowanie.
 *
 * Limit jest po stronie SERWERA, bo to samo żądanie da się wysłać curl-em.
 * Wymiarów bez biblioteki graficznej nie zweryfikujemy i świadomie tego nie
 * robimy: kosztem obrazka 1000×1000 jest brzydki podgląd, kosztem braku
 * limitu bajtów jest kolumna z kilkumegabajtowym zdjęciem z aparatu w każdej
 * odpowiedzi, która o nią zahaczy.
 */
export const MAX_AVATAR_BYTES = 64 * 1024

/**
 * Formaty przyjmowane w `avatar_url`.
 *
 * SVG-a tu NIE MA i być nie może: to dokument, który potrafi nieść skrypt, a
 * trasa `/api/avatar` oddaje go z naszego origin. Logo projektu SVG dopuszcza
 * (lib/branding.ts), ale tam adres podaje administrator, a tutaj plik wybiera
 * użytkownik.
 *
 * WebP jest tym, co produkuje nasze skalowanie. JPEG i PNG zostają, bo canvas
 * w starszym Safari po cichu oddaje inny format, gdy poprosić go o WebP —
 * odrzucenie ich znaczyłoby „nieobsługiwany format" przy poprawnie
 * przeskalowanym zdjęciu, bez żadnego sposobu, żeby to obejść.
 */
const AVATAR_MIME_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const

/**
 * Imię do zapisu albo `null`, gdy nie podano.
 *
 * `null`, nie pusty napis: kolumna jest nullowalna, a null znaczy „nie
 * podano". Pusty napis przechodziłby przez `name ?? adres` jako wartość i
 * zostawiał dziurę w stopce zadania zamiast adresu.
 *
 * Białe znaki zbijamy do pojedynczej spacji, znaki sterujące wycinamy. Imię
 * trafia do jednolinijkowych konstrukcji: stopki zadania w ClickUpie, tematu
 * maila, podpisu komentarza. Znak nowej linii rozbija każdą z nich, a wklejenie
 * imienia z innego pola razem z ogonem formatowania jest zwykłą rzeczą.
 */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const czyste = raw
    // Kolejność ma znaczenie: NAJPIERW zbijamy białe znaki (nowa linia i
    // tabulator też nimi są) do spacji, dopiero potem wycinamy pozostałe znaki
    // sterujące. Odwrotnie „Anna\nKowalska" wychodziła jako „AnnaKowalska",
    // czyli imię i nazwisko sklejone w jedno słowo.
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  return czyste.length > 0 ? czyste : null
}

export type PasswordCheck = { ok: true } | { ok: false; error: string }

/**
 * Reguły zmiany hasła z profilu.
 *
 * Stare hasło jest WYMAGANE i to jest cała istota tej strony: przejęta sesja
 * nie może przejąć konta. Bez tego pola ktoś, kto siadł przy niezablokowanym
 * laptopie, zmienia hasło i właściciel traci dostęp, nie tracąc nawet sesji.
 *
 * Nowe musi się różnić od starego, bo zmiana hasła po incydencie („ktoś zna
 * moje hasło") ma sens tylko wtedy, gdy hasło faktycznie się zmienia. Formularz
 * przyjmujący to samo hasło i mówiący „gotowe" zostawia klienta w fałszywym
 * poczuciu, że sprawa załatwiona.
 *
 * Komunikaty są po polsku i gotowe do pokazania: to jedyne miejsce, w którym
 * te reguły są zapisane, więc treść odmowy nie ma jak się rozjechać między
 * formularzem a trasą.
 */
export function validatePasswordChange(input: {
  current?: string
  next?: string
  confirm?: string
}): PasswordCheck {
  const current = typeof input?.current === 'string' ? input.current : ''
  const next = typeof input?.next === 'string' ? input.next : ''
  const confirm = typeof input?.confirm === 'string' ? input.confirm : ''

  if (current.length === 0) {
    return { ok: false, error: 'Podaj obecne hasło.' }
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Nowe hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaków.` }
  }
  if (next !== confirm) {
    return { ok: false, error: 'Nowe hasła nie są takie same.' }
  }
  if (next === current) {
    return { ok: false, error: 'Nowe hasło musi różnić się od obecnego.' }
  }
  return { ok: true }
}

export type ParsedAvatar = {
  /** Typ MIME do nagłówka odpowiedzi trasy `/api/avatar`. */
  contentType: string
  /** Sam ładunek, już bez przedrostka `data:...;base64,`. */
  base64: string
}

/**
 * Sprawdza data URI awatara i rozkłada go na części.
 *
 * Zwraca `null` przy czymkolwiek, co nie jest obrazkiem w dozwolonym formacie,
 * poprawnym base64 i mieści się w limicie. Jedno wejście dla przeglądarki
 * (zanim wyśle) i dla trasy (zanim zapisze).
 */
export function parseAvatarDataUri(value: unknown): ParsedAvatar | null {
  if (typeof value !== 'string') return null
  const uri = value.trim()
  if (uri.length === 0 || uri.length > MAX_AVATAR_BYTES) return null

  const dopasowanie = /^data:([a-z0-9+/.-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri)
  if (!dopasowanie) return null

  const [, mime, base64] = dopasowanie
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(mime)) return null
  // Base64 koduje po cztery znaki na trzy bajty, więc długość niepodzielna
  // przez cztery znaczy ładunek ucięty w transporcie. `Buffer.from` przełknąłby
  // to po cichu i zapisalibyśmy uszkodzony obrazek.
  if (base64.length === 0 || base64.length % 4 !== 0) return null

  return { contentType: mime, base64 }
}

/**
 * Największy kwadrat wycięty ze środka obrazka, do przekazania `drawImage`.
 *
 * Kadrowanie ze środka zamiast rozciągania: awatar w kółku i tak pokazuje
 * środek, a zniekształcona twarz wygląda gorzej niż ucięte tło. Współrzędne są
 * całkowite, bo ułamkowe dają rozmycie widoczne przy 256 px.
 */
export function cropSquare(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height)
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
  }
}

/**
 * Inicjały do kółka awatara, gdy zdjęcia nie ma.
 *
 * Konta zakłada admin i imię bywa puste, więc zapasem jest adres. Puste kółko
 * wyglądałoby na niedokończony portal, a nie na brak jednego pola. Znak
 * zapytania na końcu jest po to, żeby funkcja NIGDY nie zwróciła pustego
 * napisu: wołający wstawia wynik do kółka o stałym rozmiarze.
 */
export function avatarInitials(name: string | null | undefined, email: string): string {
  const czyste = normalizeName(name)
  if (czyste) {
    const czlony = czyste.split(' ').filter(Boolean).slice(0, 2)
    const litery = czlony.map(c => c[0]).join('')
    if (litery) return litery.toUpperCase()
  }
  const zAdresu = email.trim()[0]
  return zAdresu ? zAdresu.toUpperCase() : '?'
}
