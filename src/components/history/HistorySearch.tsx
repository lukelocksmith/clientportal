'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Search, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Pole wyszukiwania. Jedyny kliencki element paska filtrów, bo pozostałe
 * filtry są zwykłymi linkami (wzorzec z PeriodPicker) i nie potrzebują stanu.
 *
 * Debounce 350 ms plus useTransition: przy każdym wciśnięciu klawisza nie
 * przeładowujemy strony, a gdy już przeładowujemy, `isPending` daje kręciołek
 * zamiast zamrożonego widoku.
 *
 * Zmiana frazy ZERUJE kursor stronicowania. Bez tego klient szukający będąc na
 * trzeciej stronie dostałby pustkę, bo kursor wskazywałby miejsce, którego w
 * nowym, węższym zbiorze wyników nie ma.
 */
export function HistorySearch({ placeholder }: { placeholder?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const urlQuery = params.get('q') ?? ''
  const [value, setValue] = useState(urlQuery)

  // Gdy adres zmieni się z zewnątrz (klik w „Wyczyść", przycisk wstecz),
  // pole musi za tym pójść. Korekta w trakcie renderu, nie w useEffect:
  // to udokumentowany wzorzec Reacta na stan pochodny od propsów, bez
  // dodatkowego przebiegu renderowania i bez kaskady, którą useEffect tu
  // wywoływał (react-hooks/set-state-in-effect).
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery)
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery)
    setValue(urlQuery)
  }

  // Pierwszy przebieg nie może nawigować, inaczej wejście na stronę z ?q=
  // natychmiast by ją przeładowało.
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (value === urlQuery) return

    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString())
      if (value.trim()) next.set('q', value.trim())
      else next.delete('q')
      next.delete('kursor')
      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`, { scroll: false })
      })
    }, 350)

    return () => clearTimeout(timer)
    // `params` celowo poza zależnościami: zmiana adresu po naszej własnej
    // nawigacji nie może uruchomić kolejnej nawigacji.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, urlQuery, pathname, router])

  return (
    <div className="relative flex-1 min-w-[220px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder ?? 'Szukaj w nazwach, opisach i załącznikach'}
        aria-label="Szukaj zgłoszeń"
        className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            onClick={() => setValue('')}
            aria-label="Wyczyść szukanie"
            className="text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
