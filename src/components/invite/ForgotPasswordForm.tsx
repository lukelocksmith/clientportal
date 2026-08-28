'use client'
import { useState } from 'react'
import { CheckCircle2, Loader2 } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Formularz „nie pamiętam hasła".
 *
 * Po wysłaniu pokazujemy potwierdzenie, które NIE mówi, czy konto istniało.
 * Serwer zwraca tę samą odpowiedź w obu przypadkach, więc formularz nie ma
 * czego zdradzić, i tak ma zostać. Gdyby tu pojawiło się „nie znaleźliśmy
 * takiego adresu", cała ochrona po stronie serwera byłaby bez znaczenia.
 */
export function ForgotPasswordForm({ slug }: { slug: string }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || sending) return
    setError(null)
    setSending(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), slug }),
      })
      if (!res.ok) {
        setError('Coś poszło nie tak. Spróbuj ponownie za chwilę.')
        return
      }
      setDone(true)
    } catch {
      setError('Brak połączenia. Spróbuj ponownie.')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-500" />
        <p className="text-sm text-foreground">
          Jeśli konto o tym adresie istnieje, wysłaliśmy na nie link do ustawienia nowego hasła.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Sprawdź też folder ze spamem. Link jest ważny 2 godziny.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="forgot-email">
          Adres e-mail
        </label>
        <Input
          id="forgot-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          required
          placeholder="twoj@adres.pl"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={!email.trim() || sending} className="w-full">
        {sending && <Loader2 className="h-4 w-4 animate-spin" />}
        {sending ? 'Wysyłanie...' : 'Wyślij link'}
      </Button>
    </form>
  )
}
