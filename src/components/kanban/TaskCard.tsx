'use client'
import { useState, type ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ClickUpTask } from '@/lib/types'
import {
  formatDateRange, formatDuration, getPriorityColor, getPriorityCode, getStatusColor,
  isAwaria, isOverdue,
} from '@/lib/utils'
import { Calendar, Clock, Timer, ChevronRight, ListTree, AlertTriangle } from '@/lib/icons'

interface TaskCardProps {
  task: ClickUpTask
  onClick: (task: ClickUpTask) => void
}

/**
 * Plakietka metadanych: JEDEN kształt dla wszystkiego, co karta mówi o zadaniu.
 *
 * Do 28.08 każda informacja miała własny wygląd: priorytet w obrysie, termin
 * w obrysie, a estymata i Track Time jako goły tekst z ikoną, w osobnym wierszu
 * niżej. Cztery różne formy dla czterech rzeczy tej samej rangi czytały się jak
 * cztery różne rangi.
 *
 * Wyrównanie trzymają trzy rzeczy, wszystkie potrzebne:
 *   - stała WYSOKOŚĆ (`h-6`) zamiast pionowego paddingu, więc plakietki
 *     z ikoną i bez ikony są dokładnie tak samo wysokie,
 *   - `leading-none`, bo domyślna interlinia dokłada nad i pod tekstem
 *     niesymetryczny margines i tekst siada wtedy o pikselniżej niż glif,
 *   - `tabular-nums`, żeby „1h 30m" i „11h 30m" nie przeskakiwały w poziomie
 *     przy odświeżeniu godzin.
 */
function Badge({
  children, tone = 'plain', title,
}: {
  children: ReactNode
  tone?: 'plain' | 'filled' | 'alarm' | 'late'
  title?: string
}) {
  /* Każdy wariant ma obrys, także wypełnione: bez tego treść wewnątrz
     przesuwa się o piksel względem sąsiadów i wiersz przestaje być równy.
     Wypełnienie bierze `accent`, NIE `muted`: w ciemnym motywie `--muted`
     i `--card` to ten sam #252525, więc plakietka na karcie była niewidoczna. */
  const tones = {
    plain: 'border border-border text-muted-foreground',
    filled: 'border border-transparent bg-accent text-muted-foreground',
    alarm: 'border border-transparent bg-destructive/15 text-destructive font-semibold',
    late: 'border border-destructive/40 text-destructive',
  }
  return (
    <span
      title={title}
      className={`inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium leading-none tabular-nums ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/** Rozmiar ikony w plakietce. Jedno miejsce, bo mają być identyczne co do piksela. */
const ICON = 'h-3.5 w-3.5 shrink-0'

export function TaskCard({ task, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })

  const [expanded, setExpanded] = useState(true) // subtasks expanded by default (like ClickUp)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const priorityColor = getPriorityColor(task.priority?.priority)
  const awaria = isAwaria(task.tags)
  const children = task.children ?? []
  const estimate = formatDuration(task.time_estimate)
  const tracked = formatDuration(task.trackedTimeMs)
  const dates = formatDateRange(task.date_start, task.date_due)
  const overdue = isOverdue(task.date_due, task.status?.type)
  const hasMeta = Boolean(awaria || task.priority?.priority || dates || estimate || tracked)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(task)}
      /* Karta PŁASKA, bez cienia. Przy dwudziestu kartach na ekranie cień z
         każdej z nich sumuje się w szary szum i zabiera wrażenie porządku;
         sam obrys wystarcza, żeby oddzielić kartę od tła kolumny. Podniesienie
         zostawiamy na przeciąganie, gdzie faktycznie znaczy „ta karta jest w
         powietrzu". */
      className="bg-card rounded-lg border border-border px-3 py-2.5 cursor-pointer hover:border-foreground/20 hover:bg-accent/40 transition-colors group select-none"
    >
      {/* Nazwa i licznik podzadań w jednym wierszu.
          Licznik był wcześniej w wierszu metadanych i to on wypychał całą linię
          do zawinięcia na karcie z pełnym zestawem plakietek: zabierał ostatnie
          30 px. Przy nazwie kosztuje zero, bo nazwa i tak ma tam luz. */}
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm font-medium leading-snug text-card-foreground line-clamp-2">
          {task.name}
        </p>
        {children.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(v => !v)
            }}
            className="flex h-5 shrink-0 items-center gap-0.5 text-[11px] leading-none tabular-nums text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={expanded}
            aria-label={expanded ? 'Zwiń podzadania' : 'Rozwiń podzadania'}
          >
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            <ListTree className={ICON} />
            {children.length}
          </button>
        )}
      </div>

      {/* JEDEN wiersz metadanych. Kolejność od najpilniejszej informacji do
          najbardziej sprawozdawczej: awaria, priorytet, daty, plan, wykonanie.

          `flex-wrap` zostaje jako siatka bezpieczeństwa, nie jako układ: przy
          kolumnie 360 px pełny zestaw plakietek mieści się w linii, ale bardzo
          długa estymata albo szerszy język zawinie się zamiast wystawać. */}
      {hasMeta && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {/* ALARM zostaje wypełniony kolorem, ale BEZ słowa „Alarm": sam
              trójkąt w czerwonej pastylce niesie ten sam sygnał, a słowo
              zabierało 35 px, których wiersz nie ma. Znaczenie dopowiada
              tooltip, a szuflada pisze je wprost. */}
          {awaria && (
            <Badge tone="alarm" title="Zgłoszenie awaryjne">
              <AlertTriangle className={ICON} aria-hidden />
              <span className="sr-only">Alarm</span>
            </Badge>
          )}

          {/* PRIORYTET jako kropka i kod, bez wypełnionego tła.
              Plakietka z kolorowym tłem na KAŻDEJ karcie (priorytet rysujemy
              zawsze) dawała ścianę kolorowych prostokątów, w której czerwony
              „Pilny" przestawał się wyróżniać, czyli kolor tracił dokładnie tę
              funkcję, dla której go użyto. */}
          {task.priority?.priority && (
            <Badge title={`Priorytet: ${task.priority.priority}`}>
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: priorityColor }}
                aria-hidden
              />
              {getPriorityCode(task.priority.priority)}
            </Badge>
          )}

          {/* DATY: start i termin w jednej plakietce, bo to jeden przedział
              czasu, nie dwie niezależne informacje. Czerwień zapala się
              wyłącznie na terminie, który minął, i to jest teraz jej jedyne
              zadanie na karcie: zwolniła się z Track Time. */}
          {dates && (
            <Badge tone={overdue ? 'late' : 'plain'} title={overdue ? 'Termin minął' : 'Start i termin'}>
              <Calendar className={ICON} aria-hidden />
              {dates}
            </Badge>
          )}

          {/* PLAN (estymata) w obrysie, WYKONANIE (Track Time) w wypełnieniu.
              Dwie plakietki obok siebie różnią się nie kolorem, tylko wagą tła,
              więc para czyta się jako „ile planowaliśmy / ile zeszło" bez
              ani jednego dodatkowego słowa. Track Time NIE jest już czerwony:
              czerwień na karcie klienta ma znaczyć kłopot, a przepracowane
              godziny kłopotem nie są. */}
          {estimate && (
            <Badge title="Szacowany czas">
              <Clock className={ICON} aria-hidden />
              {estimate}
            </Badge>
          )}
          {tracked && (
            <Badge tone="filled" title="Track Time (tygodniowy)">
              <Timer className={ICON} aria-hidden />
              {tracked}
            </Badge>
          )}
        </div>
      )}

      {/* Nested subtasks (expandable, ClickUp-style) */}
      {expanded && children.length > 0 && (
        <div
          className="mt-2 pt-2 border-t border-border/60 space-y-1"
          onClick={(e) => e.stopPropagation()}
        >
          {children.map(sub => {
            const subEstimate = formatDuration(sub.time_estimate)
            return (
              <button
                key={sub.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick(sub)
                }}
                className="w-full flex items-center gap-2 text-left rounded px-1.5 py-1 hover:bg-muted transition-colors"
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getStatusColor(sub.status.status) }}
                />
                <span
                  className={`flex-1 text-xs truncate ${sub.status.type === 'closed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}
                >
                  {sub.name}
                </span>
                {subEstimate && (
                  <span className="text-[11px] leading-none tabular-nums text-muted-foreground flex-shrink-0">
                    {subEstimate}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
