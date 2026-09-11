'use client'
import { useState } from 'react'
import { NewTaskButton } from '@/components/kanban/NewTaskButton'
import { TaskFormDialog } from '@/components/kanban/TaskFormDialog'

/**
 * Trzy stany do obejrzenia naraz: menu „Nowe zadanie", formularz pusty
 * i formularz z treścią przeniesioną z nieudanej rozmowy z asystentem.
 *
 * Dołożony też pasek, który klient widzi w czacie, gdy asystent obieca
 * zgłoszenie i go nie zapisze — w samym czacie zobaczyłbym go tylko wtedy,
 * gdyby model akurat się pomylił, a na to nie da się czekać.
 */
export function ZgloszeniePodglad() {
  const [formularz, setFormularz] = useState<{ nazwa: string; opis: string } | null>(null)

  const zRozmowy = {
    nazwa: 'Baner na stronie głównej do podmiany',
    opis: 'Baner na stronie głównej do podmiany. Mamy gotową grafikę.\n\nimportant.is, sekcja na samej górze\n\nzgłoś to jako zadanie',
  }

  return (
    <div className="min-h-screen bg-background p-8 space-y-10">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-foreground">Drogi zgłoszenia</h1>
        <p className="text-sm text-muted-foreground">
          Podgląd lokalny. Przycisk zgłoszenia naprawdę wyśle żądanie, więc go nie klikaj.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Projekt ze stroną (SitePing) — trzy drogi</h2>
        <NewTaskButton
          siteUrl="https://gemsonyx.com"
          onOpenAssistant={() => {}}
          onOpenForm={() => setFormularz({ nazwa: '', opis: '' })}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Projekt bez strony — asystent i formularz</h2>
        <NewTaskButton
          siteUrl={null}
          onOpenAssistant={() => {}}
          onOpenForm={() => setFormularz({ nazwa: '', opis: '' })}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Pasek w czacie: asystent obiecał i nie zapisał</h2>
        <div className="max-w-sm space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">Asystent nie zapisał tego zgłoszenia.</p>
          <p>
            Zapisaliśmy je z Waszej rozmowy i pojawi się na tablicy w ciągu kilku minut.
            Jeśli chcesz mieć pewność albo coś poprawić, wypełnij formularz.
          </p>
          <button
            type="button"
            onClick={() => setFormularz(zRozmowy)}
            className="rounded-md bg-amber-600 px-2.5 py-1.5 font-medium text-white hover:bg-amber-700 transition-colors"
          >
            Zgłoś formularzem
          </button>
        </div>
      </section>

      {formularz && (
        <TaskFormDialog
          slug="podglad"
          poczatkowaNazwa={formularz.nazwa}
          poczatkowyOpis={formularz.opis}
          onClose={() => setFormularz(null)}
          onCreated={() => {}}
        />
      )}
    </div>
  )
}
