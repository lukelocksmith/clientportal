'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrandMark } from '@/components/BrandMark'

/**
 * Formularz logowania. Wydzielony z page.tsx, żeby sama strona mogła być
 * serwerowa i pobrać markę projektu (kolor, logo, nazwę) z bazy.
 *
 * Wcześniej cała strona była kliencka i z tego powodu rysowała kwadrat w
 * kolorze important.is oraz pierwszą literę SLUGA zamiast nazwy projektu.
 * Pierwszy ekran, jaki widzi klient, pokazywał więc naszą markę zamiast jego.
 */
export function LoginForm({ slug }: { slug: string }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, slug }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Błąd logowania')
        return
      }

      router.push(`/${slug}`)
      router.refresh()
    } catch {
      setError('Brak połączenia. Spróbuj ponownie.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="login-email">
            Email
          </label>
          <Input
            id="login-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="twoj@email.com"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground" htmlFor="login-password">
            Hasło
          </label>
          <Input
            id="login-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? 'Logowanie...' : 'Zaloguj się'}
        </Button>
      </form>

      {/* Link publiczny, jak sama strona logowania. */}
      <p className="mt-4 text-center text-sm">
        <Link
          href={`/${slug}/przypomnienie`}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Nie pamiętam hasła
        </Link>
      </p>

      <BrandMark className="mt-6 text-center text-xs text-muted-foreground" />
    </>
  )
}
