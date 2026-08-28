'use client'
import { useRef, useState } from 'react'
import { Loader2, Trash2, Upload } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { AVATAR_SIZE } from '@/lib/profile'
import { checkAvatarFile, scaleToAvatarDataUri } from '@/lib/avatarImage'

/**
 * Zdjęcie profilowe: wgranie, podgląd, usunięcie.
 *
 * Podgląd wskazuje na TRASĘ `/api/avatar`, nigdy na data URI wstawione w HTML.
 * Kolumna `avatar_url` ma przy sobie zakaz wkładania data URI w payloady, bo
 * to dziesiątki kilobajtów przy każdym renderze; ta strona jest pierwszym
 * miejscem, w którym łatwo ten zakaz złamać.
 *
 * `?v=` w adresie po zapisie: obrazek pod tym samym adresem siedzi w cache
 * przeglądarki, więc bez zmiany adresu klient po wgraniu nowego zdjęcia
 * widziałby przez chwilę stare i uznałby, że nic się nie zapisało.
 */
export function AvatarForm({
  slug,
  hasAvatar,
  initials,
}: {
  slug: string
  hasAvatar: boolean
  /** Zapas, gdy zdjęcia nie ma. Puste kółko wygląda na niedokończony portal. */
  initials: string
}) {
  const [ma, setMa] = useState(hasAvatar)
  const [wersja, setWersja] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function zapisz(avatar: string | null) {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Samo zdjęcie. Imienia NIE dotykamy: brak pola znaczy „nie ruszaj".
        body: JSON.stringify({ slug, avatar }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Nie udało się zapisać zdjęcia.')
        return
      }
      setMa(avatar !== null)
      setWersja(v => v + 1)
    } catch {
      setError('Brak połączenia. Spróbuj ponownie.')
    } finally {
      setBusy(false)
    }
  }

  async function wybierz(file: File) {
    const powod = checkAvatarFile(file)
    if (powod) {
      setError(powod)
      return
    }
    setError(null)
    setBusy(true)
    try {
      // Skalowanie idzie w przeglądarce, więc serwer dostaje gotowy, mały
      // obrazek. Limit po jego stronie i tak zostaje: przeglądarka nie jest
      // granicą bezpieczeństwa.
      const dataUri = await scaleToAvatarDataUri(file)
      setBusy(false)
      await zapisz(dataUri)
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : 'Nie udało się przygotować zdjęcia.')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
        {ma ? (
          // Zwykły <img>, nie next/image: adres jest naszą trasą API zwracającą
          // bajty, a next/image chciałby ją optymalizować i cache'ować po swojemu.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/avatar?slug=${encodeURIComponent(slug)}&v=${wersja}`}
            alt="Twoje zdjęcie profilowe"
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground">
            {initials}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            // Czyścimy pole od razu, żeby wybór TEGO SAMEGO pliku drugi raz
            // (po nieudanej próbie) znów wywołał zdarzenie zmiany.
            e.target.value = ''
            if (file) void wybierz(file)
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {ma ? 'Zmień zdjęcie' : 'Wgraj zdjęcie'}
          </Button>

          {ma && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void zapisz(null)}
            >
              <Trash2 className="h-4 w-4" />
              Usuń zdjęcie
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Zdjęcie zmniejszamy u Ciebie w przeglądarce do {AVATAR_SIZE}×{AVATAR_SIZE} px. Do nas
          trafia już tylko mały obrazek.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
