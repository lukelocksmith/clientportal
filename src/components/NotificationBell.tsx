'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, MessageSquare, ArrowRightLeft, CheckCircle2, ShieldCheck, FilePlus2, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { relativeTime, exactTime } from '@/lib/relativeTime'

type Item = {
  id: string
  /**
   * Zwykły `string`, nie unia. Wiersz w bazie może mieć rodzaj nowszy niż ten
   * komponent (nowy rodzaj wdrożony wcześniej niż nowy dzwonek), a wtedy unia
   * kłamie i tak. Nieznany rodzaj obsługujemy zapasem, patrz `IKONY` niżej.
   */
  kind: string
  taskId: string | null
  taskName: string
  payload: Record<string, unknown>
  createdAt: string
  read: boolean
}

/**
 * Jak opisać zdarzenie jednym zdaniem.
 *
 * Treść bierzemy z `payload`, nie z ClickUpa: powiadomienie ma pozostać
 * czytelne także wtedy, gdy zadanie zmieniło się od tamtej pory albo zniknęło.
 */
function describe(item: Item): string {
  const p = item.payload as { from?: string; to?: string; author?: string; excerpt?: string }
  switch (item.kind) {
    case 'comment':
      return p.excerpt ? `${p.author ?? 'Zespół'}: ${p.excerpt}` : 'Nowa odpowiedź zespołu'
    case 'closed':
      return 'Sprawa zamknięta'
    case 'status':
      return p.from && p.to ? `Status: ${p.from} → ${p.to}` : 'Zmiana statusu'
    case 'created':
      return 'Nowe zadanie w Twoim projekcie'
    case 'panic_ack':
      return 'Zespół podjął Twój alarm'
    default:
      return 'Coś się zmieniło w tej sprawie'
  }
}

/**
 * Ikona rodzaju zdarzenia.
 *
 * Lista bez ikon zmusza do CZYTANIA kazdej pozycji, zeby stwierdzic, czy to
 * odpowiedz zespolu, czy zmiana statusu. Ikona pozwala przelecec wzrokiem
 * i zatrzymac sie na tym, co wazne.
 */
const IKONY: Record<string, typeof Bell> = {
  comment: MessageSquare,
  created: FilePlus2,
  status: ArrowRightLeft,
  closed: CheckCircle2,
  panic_ack: ShieldCheck,
}

/**
 * Zapas dla rodzaju, którego ten dzwonek nie zna.
 *
 * Bez niego `IKONY[kind]` daje `undefined`, React próbuje wyrenderować to jako
 * komponent i wywala CAŁĄ listę, nie jedną pozycję. Klient widzi wtedy pusty
 * dzwonek zamiast powiadomień, których ma kilka. Jeden nieznany rodzaj nie może
 * kosztować wszystkich pozostałych.
 */
const IKONA_ZAPASOWA = Bell
const NAZWA_ZAPASOWA = 'Powiadomienie'

/** Nazwa rodzaju, czytana przez czytniki ekranu zamiast samej ikony. */
const NAZWY_RODZAJU: Record<string, string> = {
  comment: 'Odpowiedź',
  created: 'Nowe zadanie',
  status: 'Zmiana statusu',
  closed: 'Zamknięte',
  panic_ack: 'Alarm podjęty',
} as const

/**
 * Dzwonek z licznikiem nieprzeczytanych.
 *
 * Odświeżanie pollingiem co 60 sekund i przy każdej zmianie adresu. Świadomie
 * BEZ WebSocketów: przy tej skali byłby to drugi kanał transportu do
 * utrzymania, a minuta opóźnienia na powiadomieniu, które i tak dubluje maila,
 * nikomu nie szkodzi.
 */
export function NotificationBell({ slug }: { slug: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const pathname = usePathname()

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?slug=${slug}`)
      if (!res.ok) return
      const data = await res.json()
      setItems(data.items ?? [])
      setUnread(data.unread ?? 0)
    } catch {
      // Cisza jest tu właściwa: nieudane odpytanie dzwonka nie może wyrzucić
      // klientowi błędu na ekran ani zepsuć strony, na której akurat pracuje.
    }
  }, [slug])

  useEffect(() => {
    // Reguła set-state-in-effect wskazuje tu fałszywy alarm: `load` ustawia
    // stan dopiero PO dwóch awaitach (fetch i json), więc nie ma tu żadnego
    // synchronicznego setState ani kaskady renderów. To zwykłe pobranie
    // danych przy montowaniu, którego bez efektu zrobić się nie da.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load, pathname])

  /**
   * Oznacza JEDNO powiadomienie jako przeczytane.
   *
   * Wołane przy kliknięciu w pozycję, czyli w chwili, w której klient
   * faktycznie się nią zajął. Wcześniej licznik schodził wyłącznie przyciskiem
   * „oznacz wszystkie", więc przeczytanie jednej sprawy nie zmieniało niczego
   * i cyfra przy dzwonku kłamała.
   *
   * Stan lokalny zmieniamy OD RAZU, przed odpowiedzią serwera: klient zaraz
   * opuszcza tę stronę (pozycja jest linkiem), więc czekanie na odpowiedź
   * znaczyłoby, że nie zobaczy skutku swojego kliknięcia.
   */
  async function markOne(id: string) {
    const pozycja = items.find(i => i.id === id)
    if (!pozycja || pozycja.read) return

    setItems(prev => prev.map(i => (i.id === id ? { ...i, read: true } : i)))
    setUnread(prev => Math.max(0, prev - 1))

    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, ids: [id] }),
    }).catch(() => load())
  }

  /**
   * Kasuje JEDNO powiadomienie.
   *
   * Oznaczenie jako przeczytane wycisza licznik, ale zostawia pozycję na
   * liście — a klient, który sprawę załatwił, chce ją stąd usunąć. Bez tego
   * dzwonek rośnie w nieskończoność i po tygodniu przestaje się nadawać do
   * czegokolwiek.
   */
  async function removeOne(id: string) {
    const pozycja = items.find(i => i.id === id)
    if (!pozycja) return

    setItems(prev => prev.filter(i => i.id !== id))
    if (!pozycja.read) setUnread(prev => Math.max(0, prev - 1))

    // Przy niepowodzeniu przeładowujemy listę, żeby pozycja wróciła —
    // zniknięcie z ekranu bez skasowania w bazie byłoby kłamstwem.
    await fetch('/api/notifications', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, ids: [id] }),
    }).catch(() => load())
  }

  async function markAll() {
    if (unread === 0) return
    setUnread(0)
    setItems(prev => prev.map(i => ({ ...i, read: true })))
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }).catch(() => load())
  }

  return (
    <DropdownMenu onOpenChange={open => { if (open) load() }}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={unread > 0 ? `Powiadomienia, nieprzeczytane: ${unread}` : 'Powiadomienia'}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-semibold text-foreground">Powiadomienia</span>
          {unread > 0 && (
            <button onClick={markAll} className="text-xs text-muted-foreground hover:text-foreground">
              Oznacz jako przeczytane
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nic nowego. Damy znać, gdy coś się wydarzy.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {/* Każda pozycja MUSI być DropdownMenuItem z `asChild`, a nie
                zwykłym <Link> w <li>. Radix zarządza wskaźnikiem i fokusem
                wewnątrz menu, więc link postawiony obok tego mechanizmu
                wygląda na klikalny, ale kliknięcie do niego nie dochodzi.
                Zgłoszone przez Łukasza 2026-08-06: „nie klikają się linki". */}
            {items.map(item => (
              <div
                key={item.id}
                className={
                  'group relative flex items-stretch border-b border-border last:border-b-0 ' +
                  (item.read ? '' : 'bg-primary/5')
                }
              >
              <DropdownMenuItem asChild className="cursor-pointer rounded-none p-0 flex-1">
                <Link
                  onClick={() => markOne(item.id)}
                  href={item.taskId ? `/${slug}?task=${item.taskId}` : `/${slug}`}
                  className="flex w-full items-start gap-3 py-3 pl-3 pr-9"
                >
                  <span
                    className={
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ' +
                      (item.read ? 'bg-muted text-muted-foreground' : 'bg-primary/15 text-primary')
                    }
                  >
                    {(() => {
                      const Ikona = IKONY[item.kind] ?? IKONA_ZAPASOWA
                      return <Ikona className="h-3.5 w-3.5" aria-hidden />
                    })()}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      {/* Rodzaj zdarzenia slowami: ikona sama nie wystarcza
                          czytnikowi ekranu, a przy podobnych ikonach tez oku. */}
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {NAZWY_RODZAJU[item.kind] ?? NAZWA_ZAPASOWA}
                      </span>
                      <span
                        className="shrink-0 text-[11px] text-muted-foreground"
                        title={exactTime(item.createdAt)}
                      >
                        {relativeTime(item.createdAt)}
                      </span>
                    </span>

                    <span className="mt-0.5 block truncate text-sm font-medium text-foreground">
                      {item.taskName}
                    </span>

                    {/* DWIE linie zamiast jednej uciętej. Tresc komentarza
                        obcieta po polowie slowa nie mowi nic i tak samo wymaga
                        wejscia w zadanie, wiec oszczednosc miejsca byla pozorna. */}
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted-foreground">
                      {describe(item)}
                    </span>
                  </span>
                </Link>
              </DropdownMenuItem>

              {/*
                Kasowanie POZA `DropdownMenuItem`, nie w środku: Radix traktuje
                pozycję menu jako jeden cel, więc przycisk zagnieżdżony w niej
                wyglądałby na klikalny, a kliknięcie i tak wybrałoby całą
                pozycję i przeniosło do zadania.

                `preventDefault` na `pointerdown` blokuje domyślne zamknięcie
                menu przez Radix — bez tego pierwsze kasowanie zamykałoby
                dzwonek i klient musiałby go otwierać do każdej pozycji.
              */}
              <button
                type="button"
                aria-label={`Usuń powiadomienie: ${item.taskName}`}
                onPointerDown={e => e.preventDefault()}
                onClick={() => removeOne(item.id)}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
