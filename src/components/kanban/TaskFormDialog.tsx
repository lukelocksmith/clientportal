'use client'
import { useState } from 'react'
import { Loader2 } from '@/lib/icons'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { CHAT_LEVELS } from '@/lib/priorityLevels'

/**
 * ZGŁOSZENIE BEZ ASYSTENTA. Formularz, który klient wypełnia sam.
 *
 * PO CO (11.09). Do tej pory jedyną drogą zgłoszenia z portalu był czat
 * z modelem (SitePing wymaga widgetu na stronie klienta, więc nie ma go
 * w większości projektów). Oznaczało to, że awaria dostawcy modelu albo jego
 * zwykła pomyłka zostawiały klienta bez żadnej drogi poza czerwonym przyciskiem
 * Alarm — a alarm budzi ludzi i nie nadaje się do „podmieńcie baner".
 *
 * 4 września asystent napisał klientce Onyxa, że zgłoszenie jest zapisane,
 * i go nie zapisał. Serwer od 11.09 ratuje taką rozmowę do kolejki, ale to jest
 * siatka pod klientem, a nie wybór dla niego. Ten formularz jest wyborem:
 * droga, na której nie ma modelu, więc nie ma czego halucynować.
 *
 * Idzie tą samą trasą co zgłoszenie z SitePinga (`POST /api/clickup/tasks`),
 * czyli dostaje tę samą stopkę z sesji, to samo przypisanie i tę samą kolejkę
 * przy awarii ClickUpa. Żadnej drugiej implementacji reguł.
 */

interface Props {
  slug: string
  /** Wstępna treść, gdy formularz otwiera się po nieudanej rozmowie z asystentem. */
  poczatkowaNazwa?: string
  poczatkowyOpis?: string
  onClose: () => void
  /** Woła się po udanym zgłoszeniu: tablica ma się odświeżyć. */
  onCreated: () => void
}

/** Domyślny poziom: najniższy z oferowanych. Podnosi się świadomie, nie z rozpędu. */
const DOMYSLNY_POZIOM = CHAT_LEVELS[CHAT_LEVELS.length - 1].clickup

export function TaskFormDialog({ slug, poczatkowaNazwa = '', poczatkowyOpis = '', onClose, onCreated }: Props) {
  const [nazwa, setNazwa] = useState(poczatkowaNazwa)
  const [opis, setOpis] = useState(poczatkowyOpis)
  const [poziom, setPoziom] = useState<number>(DOMYSLNY_POZIOM ?? 3)
  const [wysylka, setWysylka] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)

  async function wyslij(e: React.FormEvent) {
    e.preventDefault()
    if (!nazwa.trim() || wysylka) return
    setWysylka(true)
    setBlad(null)

    try {
      const res = await fetch('/api/clickup/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name: nazwa.trim(), description: opis.trim(), priority: poziom }),
      })
      if (!res.ok) {
        // Treść zgłoszenia ZOSTAJE w polach. Klient opisał sprawę raz i nie ma
        // powodu, żeby robił to drugi raz przez awarię po naszej stronie.
        setBlad('Nie udało się wysłać zgłoszenia. Spróbuj jeszcze raz za chwilę.')
        setWysylka(false)
        return
      }
      onCreated()
      onClose()
    } catch {
      setBlad('Nie udało się wysłać zgłoszenia. Sprawdź połączenie i spróbuj ponownie.')
      setWysylka(false)
    }
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nowe zadanie</DialogTitle>
          <DialogDescription>
            Opisz sprawę własnymi słowami. Zespół dopyta w komentarzach, jeśli czegoś zabraknie.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={wyslij} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="zadanie-nazwa" className="text-sm font-medium text-foreground">
              Czego dotyczy
            </label>
            <input
              id="zadanie-nazwa"
              value={nazwa}
              onChange={e => setNazwa(e.target.value)}
              maxLength={200}
              autoFocus
              placeholder="np. podmiana banera na stronie głównej"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="zadanie-opis" className="text-sm font-medium text-foreground">
              Szczegóły
            </label>
            <textarea
              id="zadanie-opis"
              value={opis}
              onChange={e => setOpis(e.target.value)}
              rows={6}
              maxLength={10000}
              placeholder="Adres strony, co dokładnie ma się zmienić, na kiedy."
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <fieldset className="space-y-1.5">
            {/*
              Poziomy z tej samej tablicy co prompt asystenta (lib/priorityLevels.ts).
              Bez P0: awaria ma własny czerwony przycisk, który uruchamia zegar
              i budzi dyżurną — gdyby stała tu jako pozycja listy, zgłoszenie
              awarii wyglądałoby na obsłużone, a nikt by o nim nie wiedział.
            */}
            <legend className="text-sm font-medium text-foreground">Poziom</legend>
            <div className="space-y-1.5">
              {CHAT_LEVELS.map(l => (
                <label key={l.code} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="poziom"
                    value={String(l.clickup)}
                    checked={poziom === l.clickup}
                    onChange={() => setPoziom(l.clickup as number)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-foreground">{l.code}, {l.label}</span>
                    <span className="block text-xs text-muted-foreground">{l.when}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {blad && (
            <p role="alert" className="text-sm text-destructive">{blad}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={!nazwa.trim() || wysylka}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {wysylka && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Zgłoś zadanie
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
