'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const MIN_LENGTH = 10

/**
 * Formularz ustawienia hasła z zaproszenia.
 *
 * Dwa pola, nie jedno: przy haśle, którego nikt nie podpowiada, literówka
 * przy pierwszym logowaniu jest bardzo prawdopodobna, a użytkownik nie ma
 * jak jej wykryć. Powtórzenie jest tu tańsze niż kolejny mail z nowym linkiem.
 *
 * Po sukcesie serwer zakłada sesję, więc idziemy prosto do portalu, bez
 * przechodzenia przez ekran logowania.
 */
export function SetPasswordForm({ slug, token }: { slug: string; token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tooShort = password.length > 0 && password.length < MIN_LENGTH
  const mismatch = confirm.length > 0 && password !== confirm
  const canSubmit = password.length >= MIN_LENGTH && password === confirm && !saving

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Nie udało się ustawić hasła.')
        return
      }
      // Sesja jest już ustawiona przez serwer. refresh() przed push()
      // wymusza ponowne odczytanie ciasteczka przez Server Components.
      router.refresh()
      router.push(`/${slug}`)
    } catch {
      setError('Brak połączenia. Spróbuj ponownie.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="new-password">
          Nowe hasło
        </label>
        <Input
          id="new-password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          placeholder={`min. ${MIN_LENGTH} znaków`}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="confirm-password">
          Powtórz hasło
        </label>
        <Input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      {/* Komunikaty pod polami, nie jako alert: użytkownik jeszcze pisze. */}
      {tooShort && (
        <p className="text-xs text-muted-foreground">
          Jeszcze {MIN_LENGTH - password.length} {password.length === MIN_LENGTH - 1 ? 'znak' : 'znaki'}.
        </p>
      )}
      {mismatch && <p className="text-xs text-destructive">Hasła się nie zgadzają.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={!canSubmit} className="w-full">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {saving ? 'Zapisywanie...' : 'Ustaw hasło i wejdź'}
      </Button>
    </form>
  )
}
