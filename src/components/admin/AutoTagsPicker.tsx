'use client'
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, X } from '@/lib/icons'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Props {
  spaceId: string
  selected: string[]
  onChange: (tags: string[]) => void
}

/**
 * Multiselect z tagami REALNIE istniejącymi w przestrzeni ClickUp klienta.
 *
 * Rozwijana lista z filtrem, nie rozłożone checkboxy: przestrzeń WDF ma 68
 * tagów, więc płaska lista rozpychała kartę projektu na kilkanaście rzędów,
 * gubiła to, co wybrane, i tak samo nie dawało się w niej niczego znaleźć.
 * Wybór widać jako plakietki w polu, listę tylko wtedy, gdy się jej szuka.
 *
 * Popover, nie DropdownMenu: menu przechwytuje klawisze na własny typeahead,
 * więc pole filtra w środku nie dałoby się normalnie pisać. Poza tym samo
 * pole jest ANCHOREM, a rozwijaczem jest tylko przycisk w jego środku —
 * plakietki muszą mieć własne krzyżyki, a przycisk w przycisku to
 * nieprawidłowy HTML.
 *
 * Osobny komponent, nie kod wprost w PortalConfigForm: ma własny fetch i
 * własny stan ładowania/błędu, które nie mają nic wspólnego z resztą
 * formularza (kolor, logo, kontakt) i nie powinny go blokować, gdy ClickUp
 * akurat nie odpowiada.
 */
export function AutoTagsPicker({ spaceId, selected, onChange }: Props) {
  const [tags, setTags] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

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

  /**
   * Tag wybrany wcześniej, a potem usunięty z przestrzeni w ClickUpie, nadal
   * siedzi w konfiguracji portalu i nadal leci do `createTask`. Musi być na
   * liście, żeby dało się go odznaczyć; inaczej byłby niewidzialny i
   * nieusuwalny z panelu. Wybrane idą na górę, bo przy 68 pozycjach inaczej
   * nie widać, co zaznaczone, bez przewinięcia całej listy.
   */
  const options = useMemo(() => {
    const known = tags ?? []
    const all = [...known, ...selected.filter(t => !known.includes(t))]
    const q = query.trim().toLowerCase()
    const matching = q ? all.filter(t => t.toLowerCase().includes(q)) : all
    return [...matching.filter(t => selected.includes(t)), ...matching.filter(t => !selected.includes(t))]
  }, [tags, selected, query])

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

  function toggle(tag: string) {
    onChange(selected.includes(tag) ? selected.filter(t => t !== tag) : [...selected, tag])
  }

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next)
        // Zamknięcie zeruje filtr: następne otwarcie ma pokazać całą listę,
        // nie resztkę po poprzednim szukaniu.
        if (!next) setQuery('')
      }}
    >
      <PopoverAnchor asChild>
        <div className="flex min-h-8 w-full max-w-md flex-wrap items-center gap-1 rounded-md border border-border bg-background px-1.5 py-1 focus-within:border-primary">
          {selected.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground"
            >
              {tag}
              <button
                type="button"
                onClick={() => toggle(tag)}
                aria-label={`Usuń tag ${tag}`}
                className="cursor-pointer text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <PopoverTrigger className="flex min-w-24 flex-1 cursor-pointer items-center gap-1.5 rounded px-0.5 text-left text-xs text-muted-foreground outline-none">
            {selected.length === 0 ? 'Wybierz tagi…' : 'Dodaj…'}
            <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0" />
          </PopoverTrigger>
        </div>
      </PopoverAnchor>

      <PopoverContent align="start" className="w-64 p-0">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Szukaj tagu…"
          aria-label="Szukaj tagu"
          spellCheck={false}
          className="w-full border-b border-border bg-transparent px-2.5 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
        {/* max-h + overflow, bo liczba tagów w przestrzeni klienta jest spoza
            naszej kontroli i długa lista inaczej wychodzi za ekran. */}
        <div role="group" aria-label="Tagi" className="max-h-64 overflow-y-auto p-1">
          {options.length === 0 ? (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">Brak tagów pasujących do „{query}”.</p>
          ) : (
            options.map(tag => {
              const checked = selected.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(tag)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
                    checked ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  <Check className={cn('h-3.5 w-3.5 shrink-0', checked ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{tag}</span>
                </button>
              )
            })
          )}
        </div>
        {selected.length > 0 && (
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full cursor-pointer rounded-sm px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Wyczyść wybór
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
