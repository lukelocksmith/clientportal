// @vitest-environment jsdom
/**
 * Link "Zobacz wiecej" pod kolumna "zamkniete" — nowy element, wiec test od
 * zera, nie rozszerzenie istniejacego (KanbanColumn nie mial dotad testu).
 *
 *   npx vitest run src/components/kanban/KanbanColumn.test.tsx
 */
import { describe, it, afterEach, vi } from 'vitest'
import assert from 'node:assert'
import { render, screen, cleanup } from '@testing-library/react'
import type { KanbanColumn as KanbanColumnType } from '@/lib/types'
import { KanbanColumn } from './KanbanColumn'

afterEach(cleanup)

function kolumna(nadpisz: Partial<KanbanColumnType> = {}): KanbanColumnType {
  return { id: 'zamknięte', title: 'zamknięte', color: '#008844', type: 'closed', tasks: [], ...nadpisz }
}

describe('link "Zobacz wiecej"', () => {
  it('moreHref ustawiony -> link widoczny i prowadzi na podany adres', () => {
    render(<KanbanColumn column={kolumna({ moreHref: '/wdf/historia?status=zamkni%C4%99te' })} onTaskClick={vi.fn()} />)

    const link = screen.getByRole('link', { name: /Zobacz więcej/ })
    assert.strictEqual(link.getAttribute('href'), '/wdf/historia?status=zamkni%C4%99te')
  })

  it('moreHref null -> bez linku', () => {
    render(<KanbanColumn column={kolumna({ moreHref: null })} onTaskClick={vi.fn()} />)

    assert.strictEqual(screen.queryByRole('link', { name: /Zobacz więcej/ }), null)
  })

  it('kolumna bez pola moreHref (inne kolumny) -> bez linku, bez wywalenia', () => {
    render(<KanbanColumn column={kolumna({ id: 'w trakcie', title: 'w trakcie', moreHref: undefined })} onTaskClick={vi.fn()} />)

    assert.strictEqual(screen.queryByRole('link', { name: /Zobacz więcej/ }), null)
  })
})
