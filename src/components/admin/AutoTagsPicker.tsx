'use client'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

interface Props {
  spaceId: string
  selected: string[]
  onChange: (tags: string[]) => void
}

/**
 * Checkboxy z tagami REALNIE istniejącymi w przestrzeni ClickUp klienta.
 *
 * Osobny komponent, nie kod wprost w PortalConfigForm: ma własny fetch i
 * własny stan ładowania/błędu, które nie mają nic wspólnego z resztą
 * formularza (kolor, logo, kontakt) i nie powinny go blokować, gdy ClickUp
 * akurat nie odpowiada.
 */
export function AutoTagsPicker({ spaceId, selected, onChange }: Props) {
  const [tags, setTags] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/portals/tags?spaceId=${encodeURIComponent(spaceId)}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (!cancelled) setTags(data.tags ?? [])
      })
      .catch(() => {
        if (!cancelled) setError('Nie udało się pobrać tagów z ClickUpa.')
      })
    return () => {
      cancelled = true
    }
  }, [spaceId])

  if (error) return <p className="text-xs text-destructive">{error}</p>
  if (tags === null) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Wczytuję tagi…
      </p>
    )
  }
  if (tags.length === 0) {
    return <p className="text-xs text-muted-foreground">Ta przestrzeń ClickUp nie ma jeszcze żadnych tagów.</p>
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {tags.map(tag => (
        <label
          key={tag}
          className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none"
        >
          <input
            type="checkbox"
            checked={selected.includes(tag)}
            onChange={e =>
              onChange(e.target.checked ? [...selected, tag] : selected.filter(t => t !== tag))
            }
            className="h-3.5 w-3.5 cursor-pointer accent-foreground"
          />
          <span className="text-foreground">{tag}</span>
        </label>
      ))}
    </div>
  )
}
