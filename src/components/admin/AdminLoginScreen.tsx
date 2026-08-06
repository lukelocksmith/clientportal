'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Ekran logowania do panelu admina.
 *
 * Trzyma email, hasło i komunikat błędu U SIEBIE, a nie w `AdminPanel`. Tamten
 * komponent miał 26 stanów, z czego trzy dotyczyły wyłącznie tego formularza,
 * czyli ekranu, który po zalogowaniu nie istnieje. Stan formularza logowania
 * nie ma powodu żyć tak długo jak panel.
 *
 * `onLoggedIn` woła się po odpowiedzi 200, żeby panel pobrał dane. Bez tego
 * po zalogowaniu widać pusty panel: `authed` przestało mieć własny efekt.
 */
export function AdminLoginScreen({ onLoggedIn }: { onLoggedIn: () => void | Promise<void> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (res.ok) {
      setError('')
      await onLoggedIn()
    } else {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Błąd logowania')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary text-primary-foreground text-xl font-bold mb-4">i</div>
          <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
          <p className="text-sm text-muted-foreground mt-1">Client Portal — important.is</p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="admin-email">Email</label>
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus
                required
                placeholder="admin@important.is"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="admin-password">Hasło</label>
              <Input
                id="admin-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">
              Zaloguj
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
