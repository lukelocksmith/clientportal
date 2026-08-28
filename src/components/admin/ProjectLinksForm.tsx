'use client'
import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, X } from '@/lib/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isSafeHttpUrl, MAX_LINKS_PER_PORTAL, type ProjectLink } from '@/lib/projectLinks'

/**
 * Edytor linków projektu pokazywanych klientowi na Dashboardzie.
 *
 * Wiersze, nie pole tekstowe z JSON-em: to konfiguracja, którą wypełnia się
 * raz i rzadko zmienia, a wpisywanie nawiasów klamrowych z ręki jest proszeniem
 * się o literówkę w adresie, w który potem klika klient.
 *
 * Zapis podmienia CAŁY zestaw, więc usunięcie wiersza to po prostu wysłanie
 * listy bez niego. Puste wiersze i niepoprawne adresy serwer odrzuca po cichu,
 * bo dodanie pustego wiersza i niewypełnienie go jest normalnym zachowaniem.
 */
const SUGGESTIONS = ['Strona', 'Staging', 'Panel WordPress', 'Google Analytics', 'Search Console']

export function ProjectLinksForm({ slug }: { slug: string }) {
  const [links, setLinks] = useState<ProjectLink[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ładowane osobno, nie razem z listą portali: to jedyne miejsce, które tego
  // potrzebuje, a doklejanie linków do /api/admin/portals rozdmuchałoby
  // odpowiedź używaną przez cały panel.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/portal-links?slug=${encodeURIComponent(slug)}`)
      .then(r => (r.ok ? r.json() : { links: [] }))
      .then((d: { links: ProjectLink[] }) => {
        if (!cancelled) {
          setLinks(d.links ?? [])
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  function update(i: number, patch: Partial<ProjectLink>) {
    setSaved(false)
    setLinks(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/portal-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, links }),
      })
      if (!res.ok) {
        setError('Nie udało się zapisać.')
        return
      }
      const data = await res.json()
      // Bierzemy to, co serwer RZECZYWISCIE zapisał, żeby panel nie pokazywał
      // wiersza, który przy zapisie wypadł jako niepoprawny.
      setLinks(data.links ?? [])
      setSaved(true)
    } catch {
      setError('Brak połączenia.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Ładowanie linków...</p>
  }

  const invalidRows = links.filter(l => l.url.trim().length > 0 && !isSafeHttpUrl(l.url)).length

  return (
    <div className="space-y-2">
      {links.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Brak linków. Klient nie zobaczy tej sekcji na Dashboardzie.
        </p>
      )}

      {links.map((link, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={link.label}
            onChange={e => update(i, { label: e.target.value })}
            placeholder="np. Strona"
            className="h-8 w-40 text-xs"
            list="link-suggestions"
          />
          <Input
            value={link.url}
            onChange={e => update(i, { url: e.target.value })}
            placeholder="https://..."
            spellCheck={false}
            className={`h-8 flex-1 text-xs ${
              link.url.trim().length > 0 && !isSafeHttpUrl(link.url) ? 'border-destructive' : ''
            }`}
          />
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            title="Usuń link"
            onClick={() => {
              setSaved(false)
              setLinks(prev => prev.filter((_, idx) => idx !== i))
            }}
            className="text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      <datalist id="link-suggestions">
        {SUGGESTIONS.map(s => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={links.length >= MAX_LINKS_PER_PORTAL}
          onClick={() => {
            setSaved(false)
            setLinks(prev => [...prev, { label: '', url: '' }])
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Dodaj link
        </Button>

        <Button
          type="button"
          size="xs"
          onClick={save}
          disabled={saving || invalidRows > 0}
          className="disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {saved ? 'Zapisane' : 'Zapisz linki'}
        </Button>

        {invalidRows > 0 && (
          <span className="text-xs text-destructive">
            Adres musi zaczynać się od https:// albo http://
          </span>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  )
}
