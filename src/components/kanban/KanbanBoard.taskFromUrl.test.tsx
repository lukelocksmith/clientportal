// @vitest-environment jsdom
import { describe, it, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import type { ClickUpTask } from '@/lib/types'

/**
 * Otwieranie szuflady zadania z adresu `/[slug]?task=<id>`.
 *
 * REGRESJA. Wcześniej zadanie z adresu było wyliczane w inicjalizatorze
 * `useState`, który wykonuje się WYŁĄCZNIE przy montowaniu komponentu. Klient
 * stojący już na tablicy, który klikał powiadomienie z dzwonka, dostawał
 * nawigację po stronie przeglądarki: adres się zmieniał, komponent NIE montował
 * się ponownie, więc szuflada nie otwierała się wcale.
 *
 * Działało wejście z innej zakładki i z odświeżenia, czyli akurat nie ta droga,
 * którą klient chodzi najczęściej — i dlatego błąd przeżył.
 *
 * Test odtwarza dokładnie ten scenariusz: `rerender` ze zmienionym parametrem
 * adresu, BEZ odmontowania. Zwykły `render` z gotowym `?task=` przechodziłby
 * także na zepsutej wersji.
 *
 *   npx vitest run src/components/kanban/KanbanBoard.taskFromUrl.test.tsx
 */
const { nawigacja, toast } = vi.hoisted(() => ({
  nawigacja: { parametry: new URLSearchParams() },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => nawigacja.parametry,
  usePathname: () => '/onyx',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast }))

// Cięzkie dzieci podstawione: ten test dotyczy WYŁĄCZNIE reakcji na adres.
vi.mock('./TaskDrawer', () => ({
  TaskDrawer: ({ task }: { task: ClickUpTask }) => (
    <div data-testid="szuflada">{task.name}</div>
  ),
}))
vi.mock('@/components/chat/ChatWindow', () => ({ ChatWindow: () => null }))
vi.mock('@/components/PanicButton', () => ({ PanicButton: () => null }))
vi.mock('@/components/PortalHeader', () => ({
  PortalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { KanbanBoard } from './KanbanBoard'

function zadanie(id: string, name: string): ClickUpTask {
  return {
    id, name, description: '',
    status: { status: 'w trakcie', color: '#3b6fe8', type: 'custom' },
    priority: null, tags: [], subtasks: [],
    date_created: '1700000000000', date_updated: '1700000000000',
  } as unknown as ClickUpTask
}

const ZADANIA = [zadanie('zad-1', 'Pierwsze zadanie'), zadanie('zad-2', 'Drugie zadanie')]

const wlasciwosci = {
  initialTasks: ZADANIA,
  slug: 'onyx',
  portalName: 'Onyx',
  userEmail: 'klient@onyx.pl',
  flags: { kanbanEnabled: true, reportsEnabled: false, historyEnabled: false, dashboardEnabled: false },
  branding: { brandColor: '#c8a24a', brandForeground: '#111111', logoUrl: null },
  siteUrl: null,
  statusControlsEnabled: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  nawigacja.parametry = new URLSearchParams()
  window.history.replaceState(null, '', '/onyx')
})
afterEach(cleanup)

describe('zadanie wskazane adresem', () => {
  it('REGRESJA: adres zmieniony BEZ przemontowania otwiera szuflade', async () => {
    // Klient stoi na tablicy — szuflada zamknięta.
    const { rerender } = render(<KanbanBoard {...wlasciwosci} />)
    assert.strictEqual(screen.queryByTestId('szuflada'), null)

    // Klika powiadomienie z dzwonka: Next zmienia adres po stronie
    // przeglądarki, komponent zostaje ten sam.
    nawigacja.parametry = new URLSearchParams('task=zad-2')
    rerender(<KanbanBoard {...wlasciwosci} />)

    // To jest asercja, która przed poprawką padała.
    const szuflada = await screen.findByTestId('szuflada')
    assert.strictEqual(szuflada.textContent, 'Drugie zadanie')
  })

  it('wejscie od razu z adresem tez otwiera szuflade', async () => {
    // Ta droga działała także przed poprawką (świeże montowanie), więc test
    // pilnuje, że naprawa jej nie zabrała.
    nawigacja.parametry = new URLSearchParams('task=zad-1')
    render(<KanbanBoard {...wlasciwosci} />)

    assert.strictEqual((await screen.findByTestId('szuflada')).textContent, 'Pierwsze zadanie')
  })

  it('adres BEZ parametru nie otwiera niczego', async () => {
    render(<KanbanBoard {...wlasciwosci} />)

    await waitFor(() => assert.strictEqual(screen.queryByTestId('szuflada'), null))
  })

  it('zadanie SPOZA tablicy mowi, gdzie go szukac', async () => {
    nawigacja.parametry = new URLSearchParams('task=zad-dawno-zamkniete')
    render(<KanbanBoard {...wlasciwosci} />)

    // Cisza wygladalaby jak zepsuty odnosnik w powiadomieniu.
    await waitFor(() => assert.strictEqual(toast.mock.calls.length, 1))
    assert.match(toast.mock.calls[0][0] as string, /Historii/)
    assert.strictEqual(screen.queryByTestId('szuflada'), null)
  })

  it('parametr znika z adresu, zeby wstecz nie otwieral szuflady w kolko', async () => {
    nawigacja.parametry = new URLSearchParams('task=zad-1')
    render(<KanbanBoard {...wlasciwosci} />)
    await screen.findByTestId('szuflada')

    await waitFor(() => assert.ok(!window.location.search.includes('task=')))
  })
})
