'use client'
import { useState } from 'react'
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MIN_PASSWORD_LENGTH, validatePasswordChange } from '@/lib/profile'

/**
 * Zmiana hasła z profilu.
 *
 * Pole „obecne hasło" nie jest formalnością i nie da się go pominąć: przejęta
 * sesja nie może przejąć konta. Serwer i tak je sprawdza, ale formularz bez
 * tego pola oznaczałby funkcję nie do użycia.
 *
 * Reguły (`validatePasswordChange`) są WSPÓLNE z trasą, więc komunikat, który
 * klient widzi przed wysłaniem, jest dokładnie tym, który dostałby z serwera.
 * Dwie kopie reguł kończą się formularzem blokującym to, co trasa przyjmuje,
 * albo odwrotnie.
 */
export function PasswordForm({ slug }: { slug: string }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setDone(false)

    const reguly = validatePasswordChange({ current, next, confirm })
    if (!reguly.ok) {
      setError(reguly.error)
      return
    }

    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Dokładnie te cztery pola. Trasa odrzuca nieznane, bo konto bierze
        // z sesji, a nie z ciała żądania.
        body: JSON.stringify({ slug, current, next, confirm }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Nie udało się zmienić hasła. Spróbuj ponownie.')
        return
      }
      // Czyścimy pola: zostawione hasła to gotowy materiał do przypadkowego
      // wysłania drugi raz, ze starym hasłem już nieaktualnym.
      setCurrent('')
      setNext('')
      setConfirm('')
      setDone(true)
    } catch {
      setError('Brak połączenia. Spróbuj ponownie.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="haslo-obecne">Obecne hasło</Label>
        <Input
          id="haslo-obecne"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="haslo-nowe">Nowe hasło</Label>
          <Input
            id="haslo-nowe"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={e => setNext(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="haslo-powtorz">Powtórz nowe hasło</Label>
          <Input
            id="haslo-powtorz"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Co najmniej {MIN_PASSWORD_LENGTH} znaków. Po zmianie wyślemy potwierdzenie na Twój adres.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {done && (
        <p className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
          <CheckCircle2 className="h-4 w-4" />
          Hasło zmienione. Potwierdzenie poszło mailem.
        </p>
      )}

      <Button type="submit" size="sm" disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        {saving ? 'Zapisywanie...' : 'Zmień hasło'}
      </Button>
    </form>
  )
}
