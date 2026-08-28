'use client'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { TaskCard } from '@/components/kanban/TaskCard'
import type { ClickUpTask } from '@/lib/types'

const ms = (iso: string) => String(new Date(iso).getTime())

/** Dni od dziś, żeby „spóźniony termin" był spóźniony niezależnie od daty oglądania. */
const zaDni = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return String(d.getTime())
}

const bazowe = (nadpisz: Partial<ClickUpTask> & { name: string }): ClickUpTask => ({
  id: nadpisz.name,
  description: null,
  status: { status: 'w toku', color: '#60a5fa', type: 'custom', orderindex: 1 },
  priority: null,
  assignees: [],
  date_created: ms('2026-08-01T09:00:00Z'),
  date_updated: ms('2026-08-20T09:00:00Z'),
  date_due: null,
  date_start: null,
  list: { id: '1', name: 'Lista' },
  folder: { id: '1', name: 'Folder' },
  parent: null,
  time_estimate: null,
  time_spent: null,
  url: 'https://app.clickup.com/t/x',
  ...nadpisz,
})

/**
 * Przypadki dobrane tak, żeby pokazywały granice układu, nie ładny środek:
 * karta z KOMPLETEM metadanych, karta spóźniona, karta prawie pusta, zakres dat
 * przez granicę roku i nazwa dłuższa niż dwie linijki.
 */
const ZADANIA: ClickUpTask[] = [
  bazowe({
    name: 'Awaria: sklep nie przyjmuje płatności',
    tags: [{ name: 'awaria' }],
    priority: { priority: 'urgent', color: '#f87171', id: '1', orderindex: '1' },
    date_start: zaDni(-2),
    date_due: zaDni(1),
    time_estimate: 4 * 3600_000,
    trackedTimeMs: 2.5 * 3600_000,
    children: [
      bazowe({ name: 'Sprawdzić logi bramki płatności' }),
      bazowe({ name: 'Test zamówienia na produkcji', time_estimate: 1800_000 }),
      bazowe({
        name: 'Odpowiedź do klienta',
        status: { status: 'zamknięte', color: '#4ade80', type: 'closed', orderindex: 5 },
      }),
    ],
  }),
  bazowe({
    name: 'Migracja newslettera do nowego szablonu',
    priority: { priority: 'high', color: '#fbbf24', id: '2', orderindex: '2' },
    date_due: zaDni(-8),
    time_estimate: 8 * 3600_000,
    trackedTimeMs: 6.25 * 3600_000,
  }),
  bazowe({
    name: 'Poprawki na stronie kontakt',
    priority: { priority: 'normal', color: '#60a5fa', id: '3', orderindex: '3' },
    date_start: zaDni(5),
    date_due: zaDni(9),
    time_estimate: 5400_000,
  }),
  bazowe({
    name: 'Zmiana zdjęcia w sekcji hero',
    priority: { priority: 'low', color: '#9ca3af', id: '4', orderindex: '4' },
    trackedTimeMs: 2700_000,
  }),
  bazowe({
    name: 'Bardzo długa nazwa zadania, która nie mieści się w dwóch linijkach i zostaje ucięta',
    priority: { priority: 'normal', color: '#60a5fa', id: '5', orderindex: '5' },
    date_start: ms('2026-12-28T09:00:00Z'),
    date_due: ms('2027-01-04T09:00:00Z'),
    time_estimate: 11.5 * 3600_000,
    trackedTimeMs: 11.5 * 3600_000,
    children: [bazowe({ name: 'Podzadanie' })],
  }),
]

export function KartaPodglad() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Karta kanbana, podgląd lokalny</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Prawdziwy komponent <code>TaskCard</code> w prawdziwej szerokości kolumny (360 px),
        na danych z palca. Ostatnia karta jest celowo skrajna: zakres dat przez granicę roku
        plus komplet plakietek, czyli jedyny przypadek, w którym wiersz się zawija.
      </p>
      {/* Stałe `id`: bez niego dnd-kit numeruje `aria-describedby` licznikiem
          globalnym, który po stronie serwera i klienta wychodzi inny, i React
          zgłasza rozjazd hydratacji. Dotyczy tej strony, nie karty. */}
      <DndContext id="podglad-karty">
        <SortableContext items={ZADANIA.map(t => t.id)}>
          <div className="mt-6 w-[360px] space-y-2 rounded-xl bg-muted/40 p-2">
            {ZADANIA.map(t => (
              <TaskCard key={t.id} task={t} onClick={() => {}} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
