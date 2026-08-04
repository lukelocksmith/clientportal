'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Logowanie na stronie głównej portalu, bez podawania projektu.
 *
 * Gdzie trafia użytkownik, rozstrzyga SERWER po sprawdzeniu hasła
 * (/api/auth/login-any). Ten formularz nie zna projektów i nie ma prawa znać:
 * lista, do których ktoś ma dostęp, jest informacją, którą można wydobyć bez
 * hasła, gdyby liczyć ją po stronie przeglądarki.
 *
 * Ekran wyboru projektu pojawia się tylko wtedy, gdy ten sam adres e-mail ma
 * konta w kilku projektach. Wtedy hasło jest wysyłane drugi raz, razem
 * z wybranym projektem, i sesja powstaje dopiero wtedy. Trzymanie „połowicznej"
 * sesji między krokami byłoby wpuszczeniem kogoś do projektu, którego nie wskazał.
 */
type Choice = { slug: string; name: string }

export function RootLoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<Choice[] | null>(null)

  async function submit(slug?: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login-any', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...(slug ? { slug } : {}) }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error ?? 'Nie udało się zalogować.')
        return
      }

      if (data?.kind === 'choose') {
        setChoices(data.portals ?? [])
        return
      }

      if (data?.redirect) {
        // `replace`, nie `push`: powrót „wstecz" na formularz logowania po
        // udanym wejściu do portalu nie ma sensu i wygląda jak wylogowanie.
        router.replace(data.redirect)
        return
      }

      setError('Nieoczekiwana odpowiedź serwera.')
    } catch {
      setError('Brak połączenia.')
    } finally {
      setBusy(false)
    }
  }

  if (choices) {
    return (
      <div className="w-full">
        <p className="text-sm text-foreground">Do którego projektu wejść?</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ten adres ma dostęp do kilku projektów.
        </p>
        <div className="mt-4 space-y-2">
          {choices.map(c => (
            <Button
              key={c.slug}
              onClick={() => submit(c.slug)}
              disabled={busy}
              variant="outline"
              className="w-full justify-between"
            >
              {c.name}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <Button
          variant="link"
          size="sm"
          onClick={() => { setChoices(null); setError(null) }}
          className="mt-3 px-0 text-muted-foreground"
        >
          Wróć
        </Button>
      </div>
    )
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); submit() }}
      className="w-full space-y-3"
    >
      <div>
        <label htmlFor="email" className="text-xs font-medium text-foreground">
          E-mail
        </label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="twoj@email.com"
          autoComplete="username"
          required
          className="mt-1"
        />
      </div>

      <div>
        <label htmlFor="password" className="text-xs font-medium text-foreground">
          Hasło
        </label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="mt-1"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={busy || !email || !password} className="w-full">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Zaloguj się
      </Button>
    </form>
  )
}
