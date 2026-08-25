import { AVATAR_SIZE, MAX_AVATAR_BYTES, cropSquare, parseAvatarDataUri } from './profile'

/**
 * Skalowanie zdjęcia profilowego W PRZEGLĄDARCE.
 *
 * Serwer dostaje gotowy obrazek 256×256, więc nie potrzebuje biblioteki
 * graficznej ani miejsca na oryginał. Portal nie ma magazynu obiektów (S3 ani
 * podobnego), a stawianie go dla kilkunastu awatarów byłoby nieproporcjonalne,
 * dokładnie tak samo jak przy logo projektu.
 *
 * Moduł jest osobny od `profile.ts`, bo dotyka `document` i `Image`: `profile.ts`
 * musi zostać czysty, żeby dało się go importować także w trasach.
 */

/**
 * Ile wolno wybrać w oknie wyboru pliku, ZANIM cokolwiek go dotknie.
 *
 * To nie jest limit zapisu (tym jest MAX_AVATAR_BYTES), tylko próg zdrowego
 * rozsądku: skalowanie wczytuje cały plik do pamięci karty, a zdjęcie prosto
 * z aparatu potrafi zamrozić ją na kilka sekund.
 */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

/** Kolejne próby jakości. Pierwsza, która zmieści się w limicie, wygrywa. */
const JAKOSCI = [0.85, 0.7, 0.55, 0.4]

/** Powód odmowy albo null, gdy plik nadaje się do skalowania. */
export function checkAvatarFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'To nie jest plik graficzny.'
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Plik jest za duży. Maksimum ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`
  }
  return null
}

/** Wczytuje plik do elementu `Image`. Zwykły `Image`, nie `createImageBitmap`,
 * bo ten drugi nie istnieje w części starszych przeglądarek, a różnicy w
 * jakości przy 256 px i tak nie widać. `blob:` przechodzi przez naszą CSP
 * (`img-src ... blob:`). */
function wczytaj(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Nie udało się otworzyć tego pliku jako obrazka.'))
    }
    img.src = url
  })
}

/**
 * Zdjęcie przeskalowane do kwadratu 256×256 jako data URI gotowe do zapisu.
 *
 * Format docelowy to WebP, ale wynik sprawdzamy, zamiast zakładać: canvas w
 * starszym Safari po cichu oddaje PNG, gdy poprosić go o WebP, a PNG ze
 * zdjęcia bywa dziesięć razy większy od JPEG-a i nie mieściłby się w limicie.
 * Dlatego przy braku WebP schodzimy na JPEG, a gdy nadal jest za duże,
 * obniżamy jakość. Odrzucenie zdjęcia jest ostatecznością, nie pierwszym
 * krokiem.
 */
export async function scaleToAvatarDataUri(file: File): Promise<string> {
  const img = await wczytaj(file)

  const { sx, sy, size } = cropSquare(img.naturalWidth || img.width, img.naturalHeight || img.height)
  if (size === 0) throw new Error('Ten obrazek nie ma wymiarów.')

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Przeglądarka nie pozwoliła przeskalować zdjęcia.')
  ctx.drawImage(img, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE)

  for (const format of ['image/webp', 'image/jpeg']) {
    for (const jakosc of JAKOSCI) {
      const dataUri = canvas.toDataURL(format, jakosc)
      // Format sprawdzamy z WYNIKU, nie z tego, o co poprosiliśmy.
      if (!dataUri.startsWith(`data:${format};base64,`)) break
      if (dataUri.length <= MAX_AVATAR_BYTES && parseAvatarDataUri(dataUri)) return dataUri
    }
  }

  throw new Error('Nie udało się zmniejszyć tego zdjęcia. Spróbuj innego.')
}
