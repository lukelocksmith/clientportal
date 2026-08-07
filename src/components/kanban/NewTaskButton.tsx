'use client'
import { Plus, ChevronDown, PenLine, MessageSquare } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

/**
 * „Nowe zadanie" z wyborem drogi zgłoszenia.
 *
 * Dwie drogi prowadzą do tego samego zadania w ClickUpie, ale różnią się tym,
 * co niosą: zaznaczenie na stronie daje zespołowi DOKŁADNE miejsce usterki,
 * a opis słowami działa dla spraw, które nie mają miejsca na stronie
 * („dodajcie podstronę o cenniku").
 *
 * PRZYCISK BEZ MENU, gdy portal nie zna strony klienta. To nie jest wariant
 * awaryjny, tylko stan normalny dla większości projektów: SitePing wymaga
 * osadzenia widgetu na stronie klienta i wpisania domeny w konfiguracji
 * projektu. Pokazywanie wyboru z jedną możliwą opcją byłoby kliknięciem bez
 * treści, a wyszarzoną — obietnicą, której klient nie może sam spełnić.
 */
interface Props {
  /** Adres strony klienta albo null, gdy projekt jej nie ma skonfigurowanej. */
  siteUrl: string | null
  /** Otwiera asystenta (czat „nowe zadanie"). */
  onOpenAssistant: () => void
}

export function NewTaskButton({ siteUrl, onOpenAssistant }: Props) {
  if (!siteUrl) {
    return (
      <button
        onClick={onOpenAssistant}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Nowe zadanie
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" aria-hidden />
          Nowe zadanie
          <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        {/*
          Nowa karta, nie to samo okno: klient wraca do portalu jednym
          przełączeniem, zamiast tracić tablicę i wracać przyciskiem wstecz.
          `noopener` jest tu konieczny — bez niego otwarta strona dostaje
          uchwyt do okna portalu.
        */}
        <DropdownMenuItem asChild>
          <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="cursor-pointer">
            <PenLine className="h-4 w-4" aria-hidden />
            <div>
              <p className="font-medium">Pokaż na stronie</p>
              <p className="text-xs text-muted-foreground">
                Zaznacz miejsce, którego dotyczy sprawa
              </p>
            </div>
          </a>
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={onOpenAssistant} className="cursor-pointer">
          <MessageSquare className="h-4 w-4" aria-hidden />
          <div>
            <p className="font-medium">Opisz słowami</p>
            <p className="text-xs text-muted-foreground">
              Asystent dopyta o szczegóły
            </p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
