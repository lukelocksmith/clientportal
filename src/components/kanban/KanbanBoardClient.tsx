'use client'
import dynamic from 'next/dynamic'
import type { ClickUpTask } from '@/lib/types'
import type { PortalFlags } from '@/lib/portalTabs'
import type { PortalBranding } from '@/lib/branding'

// dnd-kit uses a global ID counter that differs between SSR and CSR → hydration mismatch.
// Disabling SSR for the whole board avoids the aria-describedby DndDescribedBy-N mismatch.
const KanbanBoard = dynamic(
  () => import('./KanbanBoard').then(m => ({ default: m.KanbanBoard })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Ładowanie kanbanu...
      </div>
    ),
  }
)

interface Props {
  initialTasks: ClickUpTask[]
  slug: string
  portalName: string
  userEmail: string
  flags: PortalFlags
  branding: PortalBranding
  siteUrl: string | null
}

export function KanbanBoardClient(props: Props) {
  return <KanbanBoard {...props} />
}
