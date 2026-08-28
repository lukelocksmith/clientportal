/**
 * `buildColumns`: kolumna "zamkniete" ma limit, wlasne sortowanie (po dacie
 * zamkniecia, nie po priorytecie jak reszta) i opcjonalny link "Zobacz wiecej".
 * Pozostale kolumny nie zmieniaja zachowania — to jest regresja, ktorej ten
 * plik pilnuje.
 *
 * Trzeci parametr, `applyClosedLimit`, to `statusControlsEnabled` z
 * KanbanBoard. Testy nizej ustawiaja go WPROST na `true`, bo sprawdzaja
 * zachowanie limitu/sortowania, ktore ma sens wylacznie gdy funkcja jest
 * wlaczona. Ostatni test pilnuje drugiej strony: przy `false` kolumna
 * "zamkniete" wraca do zachowania sprzed tego planu.
 *
 *   npx vitest run src/components/kanban/KanbanBoard.buildColumns.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert'
import type { ClickUpTask } from '@/lib/types'
import { buildColumns } from './KanbanBoard'

function zadanie(nadpisz: Partial<ClickUpTask> & { id: string; status: string }): ClickUpTask {
  return {
    name: 'Zadanie',
    description: '',
    priority: null,
    tags: [],
    date_created: '1',
    date_updated: '1',
    ...nadpisz,
    status: { status: nadpisz.status, color: '#000', type: nadpisz.status === 'zamknięte' ? 'closed' : 'custom', orderindex: 0 },
  } as unknown as ClickUpTask
}

describe('buildColumns', () => {
  it('kolumna zamkniete przycina do 5, mimo wiecej zadan na wejsciu', () => {
    const zamkniete = Array.from({ length: 7 }, (_, i) =>
      zadanie({ id: `z${i}`, status: 'zamknięte', date_closed: String(i) } as Partial<ClickUpTask> & { id: string; status: string })
    )
    const kolumny = buildColumns(zamkniete, null, true)

    const kolumnaZamkniete = kolumny.find(k => k.id === 'zamknięte')!
    assert.strictEqual(kolumnaZamkniete.tasks.length, 5)
  })

  it('kolumna zamkniete sortuje po dacie zamkniecia, najnowsze pierwsze', () => {
    const zadania = [
      zadanie({ id: 'stare', status: 'zamknięte', date_closed: '100' } as Partial<ClickUpTask> & { id: string; status: string }),
      zadanie({ id: 'nowe', status: 'zamknięte', date_closed: '300' } as Partial<ClickUpTask> & { id: string; status: string }),
      zadanie({ id: 'srednie', status: 'zamknięte', date_closed: '200' } as Partial<ClickUpTask> & { id: string; status: string }),
    ]
    const kolumny = buildColumns(zadania, null, true)

    const kolumnaZamkniete = kolumny.find(k => k.id === 'zamknięte')!
    assert.deepStrictEqual(kolumnaZamkniete.tasks.map(t => t.id), ['nowe', 'srednie', 'stare'])
  })

  it('inne kolumny NIE dostaja limitu i zostaja sortowane po priorytecie jak dotychczas', () => {
    const zadania = [
      zadanie({ id: '1', status: 'w trakcie', priority: { priority: 'low', id: '1', color: '', orderindex: '1' } } as unknown as Partial<ClickUpTask> & { id: string; status: string }),
      zadanie({ id: '2', status: 'w trakcie', priority: { priority: 'urgent', id: '2', color: '', orderindex: '2' } } as unknown as Partial<ClickUpTask> & { id: string; status: string }),
    ]
    const kolumny = buildColumns(zadania, null, true)

    const wTrakcie = kolumny.find(k => k.id === 'w trakcie')!
    assert.deepStrictEqual(wTrakcie.tasks.map(t => t.id), ['2', '1'])
  })

  it('moreHref trafia WYLACZNIE do kolumny zamkniete', () => {
    const kolumny = buildColumns([], '/wdf/historia?status=zamkni%C4%99te', true)

    for (const kolumna of kolumny) {
      if (kolumna.id === 'zamknięte') assert.strictEqual(kolumna.moreHref, '/wdf/historia?status=zamkni%C4%99te')
      else assert.strictEqual(kolumna.moreHref, null, `kolumna ${kolumna.id} nie powinna mieć linku`)
    }
  })

  it('null jako closedMoreHref -> kolumna zamkniete bez linku', () => {
    const kolumny = buildColumns([], null, true)
    assert.strictEqual(kolumny.find(k => k.id === 'zamknięte')!.moreHref, null)
  })

  it('applyClosedLimit=false: kolumna zamkniete wraca do zachowania sprzed tego planu', () => {
    // Flaga statusControlsEnabled wylaczona. Jedyny sposob, w jaki zadanie
    // trafia tu z wiecej niz 5 pozycjami, to drag&drop w tej samej sesji —
    // fetch po stronie serwera jest juz za brama. Ten przypadek MUSI
    // zachowywac sie identycznie jak przed calym planem: sortByPriority, bez
    // limitu do 5, bez linku "Zobacz wiecej".
    const zamkniete = Array.from({ length: 7 }, (_, i) =>
      zadanie({
        id: `z${i}`,
        status: 'zamknięte',
        date_closed: String(i),
        priority: { priority: i === 0 ? 'urgent' : 'low', id: String(i), color: '', orderindex: String(i) },
      } as unknown as Partial<ClickUpTask> & { id: string; status: string })
    )
    const kolumny = buildColumns(zamkniete, '/wdf/historia?status=zamkni%C4%99te', false)

    const kolumnaZamkniete = kolumny.find(k => k.id === 'zamknięte')!
    assert.strictEqual(kolumnaZamkniete.tasks.length, 7, 'bez limitu przy wylaczonej fladze')
    assert.strictEqual(kolumnaZamkniete.tasks[0].id, 'z0', 'sortowanie po priorytecie, nie po dacie zamkniecia')
    assert.strictEqual(kolumnaZamkniete.moreHref, null, 'bez linku przy wylaczonej fladze')
  })
})

describe('podpis „po stronie" na kolumnach', () => {
  it('przeglad dostaje nas, weryfikacja nazwe projektu, reszta nic', () => {
    const kolumny = buildColumns([], null, true, 'Onyx')

    assert.strictEqual(kolumny.find(k => k.id === 'przegląd')!.side, 'important.is')
    assert.strictEqual(kolumny.find(k => k.id === 'weryfikacja')!.side, 'Onyx')
    assert.strictEqual(kolumny.find(k => k.id === 'w trakcie')!.side, null)
  })

  it('bez nazwy projektu weryfikacja NIE dostaje urwanego podpisu', () => {
    // Domyslny pusty argument istnieje dla starszych wywolan; ma dawac brak
    // podpisu, a nie „po stronie ".
    const kolumny = buildColumns([], null, true)
    assert.strictEqual(kolumny.find(k => k.id === 'weryfikacja')!.side, null)
    assert.strictEqual(kolumny.find(k => k.id === 'przegląd')!.side, 'important.is')
  })
})
