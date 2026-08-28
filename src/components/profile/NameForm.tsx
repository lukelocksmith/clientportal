'use client'
import { useState } from 'react'
import { Check, Loader2 } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MAX_NAME_LENGTH } from '@/lib/profile'

/**
 * Imię w profilu.
 *
 * Imię idzie do stopki zadania w ClickUpie i do podpisu komentarza, więc jest
 * tym, po czym zespół rozpoznaje, kto z drugiej strony pisze. Konta zakłada
 * admin i imię bywa wtedy puste albo skrócone, a klient nie miał do tej pory
 * jak tego poprawić.
 */
export function NameForm({ slug, initialName }: { slug: string; initialName: string | null }) {
  const [name, setName] = useState(initialName ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setError(null)
    setDone(false)
    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Samo imię. Pola `avatar` tu NIE MA i być nie może: trasa rozróżnia
        // „nie ruszaj" (brak pola) od „wyczyść" (null), więc dołożenie go tutaj
        // kasowałoby zdjęcie przy każdym zapisie imienia.
        body: JSON.stringify({ slug, name }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Nie udało się zapisać. Spróbuj ponownie.')
        return
      }
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
        <Label htmlFor="profil-imie">Imię i nazwisko</Label>
        <Input
          id="profil-imie"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="np. Anna Kowalska"
          onChange={e => {
            setName(e.target.value)
            setDone(false)
          }}
        />
        <p className="text-xs text-muted-foreground">
          Tak podpisujemy Twoje zgłoszenia i komentarze po naszej stronie.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? 'Zapisywanie...' : 'Zapisz'}
        </Button>
        {done && <span className="text-sm text-green-600 dark:text-green-500">Zapisane.</span>}
      </div>
    </form>
  )
}
