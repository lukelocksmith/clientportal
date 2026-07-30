'use client'
import { useState } from 'react'
import { Check, Loader2, Upload, X } from 'lucide-react'
import { DEFAULT_BRAND_COLOR, normalizeHexColor, readableForeground, isSafeLogoUrl } from '@/lib/branding'
import { isPlausibleEmail, normalizePhone } from '@/lib/portalContact'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Konfiguracja projektu: marka (logo, kolor) i kontakt opiekuna.
 *
 * Logo można podać adresem albo wgrać plik. Wgrany plik zamieniamy na
 * `data:image/...` i trzymamy w tej samej kolumnie `logo_url`, bo projekt nie
 * ma magazynu obiektów (S3 ani podobnego), a stawianie go dla kilku ikon byłoby
 * nieproporcjonalne. Cena tego rozwiązania: obrazek wchodzi do HTML każdej
 * strony portalu, dlatego jest twardy limit rozmiaru.
 */
const MAX_LOGO_BYTES = 48 * 1024

interface Props {
  portal: {
    slug: string; name: string
    logoUrl: string | null; brandColor: string | null
    contactName: string | null; contactEmail: string | null; contactPhone: string | null
  }
  onSaved: (changes: Partial<Props['portal']>) => void
}

export function PortalConfigForm({ portal, onSaved }: Props) {
  const [color, setColor] = useState(portal.brandColor ?? '')
  const [logo, setLogo] = useState(portal.logoUrl ?? '')
  const [cName, setCName] = useState(portal.contactName ?? '')
  const [cEmail, setCEmail] = useState(portal.contactEmail ?? '')
  const [cPhone, setCPhone] = useState(portal.contactPhone ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const normalized = normalizeHexColor(color)
  const preview = normalized ?? DEFAULT_BRAND_COLOR
  const previewText = readableForeground(preview)
  const colorInvalid = color.trim().length > 0 && normalized === null
  const logoInvalid = logo.trim().length > 0 && !isSafeLogoUrl(logo)

  const emailInvalid = cEmail.trim().length > 0 && !isPlausibleEmail(cEmail)
  const phoneInvalid = cPhone.trim().length > 0 && normalizePhone(cPhone) === null
  const invalid = colorInvalid || logoInvalid || emailInvalid || phoneInvalid

  const dirty =
    (portal.brandColor ?? '') !== color ||
    (portal.logoUrl ?? '') !== logo ||
    (portal.contactName ?? '') !== cName ||
    (portal.contactEmail ?? '') !== cEmail ||
    (portal.contactPhone ?? '') !== cPhone

  async function pickFile(file: File) {
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('To nie jest plik graficzny.')
      return
    }
    // Sprawdzamy rozmiar PLIKU, ale limit dotyczy zapisu base64, który jest
    // o około jedną trzecią większy. Dlatego próg na pliku jest niższy.
    if (file.size > MAX_LOGO_BYTES * 0.72) {
      setError(`Plik jest za duży. Maksimum około ${Math.round((MAX_LOGO_BYTES * 0.72) / 1024)} kB.`)
      return
    }

    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Nie udało się odczytać pliku'))
      reader.readAsDataURL(file)
    })

    if (dataUri.length > MAX_LOGO_BYTES) {
      setError('Po zakodowaniu plik nadal jest za duży. Zmniejsz obrazek.')
      return
    }
    if (!isSafeLogoUrl(dataUri)) {
      setError('Nieobsługiwany format. Użyj PNG, JPG, WEBP, GIF albo SVG.')
      return
    }
    setLogo(dataUri)
  }

  async function save() {
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const body = {
        slug: portal.slug,
        brandColor: color.trim() === '' ? null : color.trim(),
        logoUrl: logo.trim() === '' ? null : logo.trim(),
        contactName: cName.trim() === '' ? null : cName.trim(),
        contactEmail: cEmail.trim() === '' ? null : cEmail.trim(),
        contactPhone: cPhone.trim() === '' ? null : cPhone.trim(),
      }
      const res = await fetch('/api/admin/portals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        // Zod zwraca fieldErrors, ale przy błędzie sieci nie ma nic sensownego.
        const detail =
          data?.error?.fieldErrors
            ? Object.values(data.error.fieldErrors).flat().join(' ')
            : (data?.error ?? `HTTP ${res.status}`)
        setError(String(detail))
        return
      }
      const data = await res.json()
      onSaved({
        logoUrl: data.portal?.logoUrl ?? null,
        brandColor: data.portal?.brandColor ?? null,
        contactName: data.portal?.contactName ?? null,
        contactEmail: data.portal?.contactEmail ?? null,
        contactPhone: data.portal?.contactPhone ?? null,
      })
      setSaved(true)
    } catch {
      setError('Nie udało się zapisać.')
    } finally {
      setSaving(false)
    }
  }

  const field =
    'h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none'

  return (
    // border-b, nie border-t: formularz jest pierwszym elementem karty, więc
    // górna krawędź dublowałaby obramowanie samej karty.
    <div className="border-b border-border bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-end gap-4">
        {/* Podgląd dokładnie taki, jak w headerze portalu: ten sam rozmiar,
            ten sam kontrast tekstu. Inaczej admin sprawdzałby efekt, wchodząc
            do portalu klienta. */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Podgląd</span>
          {logo.trim() && !logoInvalid ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo.trim()}
              alt=""
              className="h-8 w-8 rounded-lg object-contain"
              style={{ backgroundColor: preview }}
            />
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
              style={{ backgroundColor: preview, color: previewText }}
            >
              {portal.name[0]?.toUpperCase()}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Kolor marki</span>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={preview}
              onChange={e => setColor(e.target.value)}
              aria-label="Wybierz kolor marki"
              className="h-8 w-8 cursor-pointer rounded-md border border-border bg-background p-0.5"
            />
            <Input
              type="text"
              value={color}
              onChange={e => setColor(e.target.value)}
              placeholder={DEFAULT_BRAND_COLOR}
              spellCheck={false}
              className={`${field} w-24 font-mono ${colorInvalid ? 'border-destructive' : ''}`}
            />
            {color && (
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                onClick={() => setColor('')}
                title="Wróć do koloru domyślnego"
                className="text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </label>

        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Logo: adres albo wgrany plik
          </span>
          <div className="flex items-center gap-1.5">
            <Input
              type="text"
              value={logo.startsWith('data:') ? `(wgrany plik, ${Math.round(logo.length / 1024)} kB)` : logo}
              readOnly={logo.startsWith('data:')}
              onChange={e => setLogo(e.target.value)}
              placeholder="https://klient.pl/logo.png"
              spellCheck={false}
              className={`${field} flex-1 ${logoInvalid ? 'border-destructive' : ''}`}
            />
            <label
              className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              title={`Maksimum około ${Math.round((MAX_LOGO_BYTES * 0.72) / 1024)} kB`}
            >
              <Upload className="h-3.5 w-3.5" />
              Wgraj
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  // Reset wartości, żeby wybór tego samego pliku po błędzie
                  // znów odpalił onChange.
                  e.target.value = ''
                  if (file) void pickFile(file)
                }}
              />
            </label>
            {logo && (
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                onClick={() => setLogo('')}
                title="Usuń logo"
                className="text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </label>

      </div>

      {/* Kontakt opiekuna. Puste pole nie znaczy "brak kontaktu", tylko
          "użyj zapasu agencji" (PORTAL_CONTACT_* albo hi@important.is),
          dlatego podpowiedzi w polach pokazują właśnie ten zapas. */}
      <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-border/60 pt-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Opiekun</span>
          <Input
            type="text"
            value={cName}
            onChange={e => setCName(e.target.value)}
            placeholder="Zespół important.is"
            className={`${field} w-40`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">E-mail kontaktowy</span>
          <Input
            type="text"
            value={cEmail}
            onChange={e => setCEmail(e.target.value)}
            placeholder="hi@important.is"
            spellCheck={false}
            className={`${field} w-52 ${emailInvalid ? 'border-destructive' : ''}`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Telefon</span>
          <Input
            type="text"
            value={cPhone}
            onChange={e => setCPhone(e.target.value)}
            placeholder="+48 600 000 000"
            spellCheck={false}
            className={`${field} w-40 ${phoneInvalid ? 'border-destructive' : ''}`}
          />
        </label>

        <Button type="button" size="xs" onClick={save} disabled={saving || !dirty || invalid}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved && !dirty ? <Check className="h-3.5 w-3.5" /> : null}
          {saved && !dirty ? 'Zapisane' : 'Zapisz'}
        </Button>
      </div>

      {(error || invalid) && (
        <p className="mt-2 text-xs text-destructive">
          {error ??
            (colorInvalid
              ? 'Kolor musi być postaci #rrggbb albo #rgb.'
              : logoInvalid
                ? 'Logo musi być adresem https/http albo obrazkiem data:image/...'
                : emailInvalid
                  ? 'Niepoprawny adres e-mail.'
                  : 'Numer może zawierać tylko cyfry, +, spacje, myślniki i nawiasy.')}
        </p>
      )}
    </div>
  )
}
