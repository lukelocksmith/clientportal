'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, AlertTriangle } from '@/lib/icons'

/**
 * Podpięcie projektu pod monitoring („Stan strony" na Dashboardzie).
 *
 * Dwie rzeczy do ustawienia, obie tutaj: token SuperChecka DLA TEGO PROJEKTU
 * i domeny (te same, co przy SitePingu, więc pokazujemy je tylko jako warunek).
 *
 * TOKEN JEST SEKRETEM i tak jest obsłużony: pole zaczyna się puste także wtedy,
 * gdy token jest zapisany, a panel wie o nim tylko tyle, że istnieje
 * (`hasSupercheckToken`). Wpisanie nowego nadpisuje stary, przycisk „Odepnij"
 * czyści pole w bazie. Nie ma tu żadnego sposobu, żeby zapisany token
 * zobaczyć: gdyby był, wystarczyłby dostęp do panelu, żeby wyjść z pełnymi
 * prawami do cudzego projektu w SuperChecku.
 */
type Portal = {
  slug: string
  siteDomains: string | null
  hasSupercheckToken?: boolean
}

interface Props {
  portal: Portal
  onSaved: (changes: Partial<Portal>) => void
}

export function MonitoringConfigSection({ portal, onSaved }: Props) {
  const [token, setToken] = useState('')
  const [zapisywanie, setZapisywanie] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [zapisane, setZapisane] = useState(false)

  async function zapisz(supercheckToken: string) {
    setZapisywanie(true)
    setBlad(null)
    setZapisane(false)
    try {
      const res = await fetch('/api/admin/portals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: portal.slug, supercheckToken }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setBlad(d?.error?.fieldErrors?.supercheckToken?.[0] ?? 'Nie udało się zapisać.')
        return
      }
      const { portal: zapisanyPortal } = await res.json()
      onSaved(zapisanyPortal)
      setToken('')
      setZapisane(true)
    } finally {
      setZapisywanie(false)
    }
  }

  const brakDomen = !portal.siteDomains

  return (
    <div className="rounded-lg border border-border p-4">
      <h4 className="text-sm font-semibold text-foreground">Monitoring strony</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Token API projektu z <code>tests.important.is</code> (Ustawienia projektu → CLI tokens).
        Osobny dla każdego projektu, bo SuperCheck nie ma wspólnego klucza.
      </p>

      <p className="mt-2 text-xs">
        {portal.hasSupercheckToken ? (
          <span className="inline-flex items-center gap-1 text-foreground">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Token ustawiony
          </span>
        ) : (
          <span className="text-muted-foreground">Token nieustawiony — kafle powiedzą, że projekt nie jest podpięty.</span>
        )}
      </p>

      {brakDomen && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Bez domen projektu nie ma jak dopasować czujek.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="sck_live_…"
          className="w-72 font-mono text-xs"
          aria-label="Token SuperChecka"
          autoComplete="off"
        />
        <Button size="sm" disabled={zapisywanie || token.trim().length === 0} onClick={() => zapisz(token.trim())}>
          Zapisz token
        </Button>
        {portal.hasSupercheckToken && (
          <Button size="sm" variant="ghost" disabled={zapisywanie} onClick={() => zapisz('')}>
            Odepnij
          </Button>
        )}
      </div>

      {blad && <p className="mt-2 text-xs text-destructive">{blad}</p>}
      {zapisane && !blad && <p className="mt-2 text-xs text-muted-foreground">Zapisane.</p>}
    </div>
  )
}
