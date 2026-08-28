'use client'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { ChevronRight } from '@/lib/icons'
import type { KanbanColumn as KanbanColumnType, ClickUpTask } from '@/lib/types'
import { TaskCard } from './TaskCard'
import { cn } from '@/lib/utils'

interface KanbanColumnProps {
  column: KanbanColumnType
  onTaskClick: (task: ClickUpTask) => void
  /** Czy w tej chwili przeciągane jest JAKIEKOLWIEK zadanie na tablicy. */
  dragging?: boolean
}

export function KanbanColumn({ column, onTaskClick, dragging = false }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  // Kolumna ma 360 px, wcześniej 280. Urosła, bo w 280 px karta z pełnym
  // zestawem plakietek (alarm, priorytet, start i termin, estymata, Track Time)
  // fizycznie nie wchodziła w jedną linię i zawijała się na dwie, a jeden
  // wiersz metadanych był celem zmiany z 28.08. Cena: mniej statusów widocznych
  // bez przewijania w poziomie.
  return (
    <div className="flex flex-col min-w-[360px] max-w-[360px]">
      {/* Nagłówek WEWNĄTRZ obrysu kolumny (px-2), żeby kropka statusu i pierwsza
          karta stały w jednej linii pionowej. Wcześniej nagłówek wisiał nad
          kontenerem i lewe krawędzie się nie zgadzały — drobiazg, ale to on
          decyduje, czy tablica wygląda na złożoną z kolumn, czy z luźnych
          elementów. */}
      {/* STAŁA wysokość nagłówka. Podpis „po stronie" ma tylko część kolumn,
          a bez zarezerwowanego miejsca kolumny bez podpisu zaczynały listę
          wyżej niż sąsiedzi i tablica wyglądała na krzywą. */}
      <div className="mb-2 h-8 px-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: column.color }} />
          <h3 className="text-[13px] font-semibold text-foreground capitalize">
            {column.title}
          </h3>
          {/* Licznik bez tła: wypełniona plakietka przy każdej z pięciu kolumn
              konkurowała wagą z nazwą kolumny, a jest informacją drugorzędną. */}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {column.tasks.length}
          </span>
        </div>
        {/* Po czyjej stronie stoi piłka. „Przegląd" i „weryfikacja" brzmią
            niemal tak samo, a znaczą coś przeciwnego, więc bez tego podpisu
            klient nie ma jak odróżnić „sprawdzamy" od „czekamy na Ciebie".
            Wyrównane do nazwy statusu, nie do kropki: kropka jest znacznikiem
            koloru, a nie początkiem tekstu. */}
        {column.side && (
          <p className="mt-0.5 pl-4 text-[11px] leading-none text-muted-foreground">
            po stronie {column.side}
          </p>
        )}
      </div>

      {/* Drop zone */}
      {/**
        * WYSOKOŚĆ KOLUMNY: przylega do zawartości, ale TYLKO w spoczynku.
        *
        * Tu są dwie sprzeczne potrzeby i obie są prawdziwe. Wygląd chce, żeby
        * kolumna kończyła się pod ostatnią kartą — rozciągnięty pusty obrys
        * pod czterema zadaniami czyta się jak błąd (zgłoszone przez Łukasza).
        * Przeciąganie chce czegoś odwrotnego: celu na tyle dużego, żeby dało
        * się upuścić kartę w kolumnie, która ma jedno zadanie albo zero.
        *
        * Rozstrzygamy CZASEM, nie kompromisem w wysokości: dopóki nikt nic nie
        * przeciąga, kolumna przylega do treści; gdy przeciąganie się zaczyna,
        * WSZYSTKIE kolumny rosną do pełnej wysokości i stają się łatwym celem.
        * Dlatego prop nazywa się `dragging`, a nie `isOver` — `isOver` wymagałby
        * najpierw trafienia w wąski pasek, czyli rozwiązywałby problem dopiero
        * po tym, jak już przestał istnieć.
        */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-col gap-2 rounded-xl border p-2 transition-colors',
          // Cel przy przeciąganiu robimy MINIMALNĄ WYSOKOŚCIĄ, nie `flex-1`:
          // `flex-1` działa tylko wtedy, gdy rodzic ma narzuconą wysokość, a
          // ta narzucona wysokość była właśnie przyczyną wylewania się kart.
          dragging ? 'min-h-[60vh]' : 'min-h-[64px]',
          isOver
            ? 'border-primary/30 bg-primary/5'
            : 'border-border/60 bg-muted/20'
        )}
      >
        <SortableContext items={column.tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {column.tasks.map(task => (
            <TaskCard key={task.id} task={task} onClick={onTaskClick} />
          ))}
        </SortableContext>

        {column.tasks.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground py-8">
            Brak zadań
          </div>
        )}
      </div>

      {column.moreHref && (
        <a
          href={column.moreHref}
          className="mt-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Zobacz więcej
          <ChevronRight className="h-3 w-3" aria-hidden />
        </a>
      )}
    </div>
  )
}
