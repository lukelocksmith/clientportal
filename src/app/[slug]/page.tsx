import { redirect } from 'next/navigation'
import { getAllTasksForFolder } from '@/lib/clickup'
import { getSnapshotMap, mergeTrackedTime } from '@/lib/timeSnapshots'
import { KanbanBoardClient } from '@/components/kanban/KanbanBoardClient'
import { firstEnabledTabPath, isTabEnabled } from '@/lib/portalTabs'
import { getPortalForSession } from '@/lib/portalSession'

export const revalidate = 60 // Revalidate every 60s, webhooks invalidate sooner

interface PortalPageProps {
  params: Promise<{ slug: string }>
}

export default async function PortalPage({ params }: PortalPageProps) {
  const { slug } = await params

  const result = await getPortalForSession(slug)
  if (!result.ok) redirect(result.reason === 'no-portal' ? '/' : `/${slug}/login`)
  const { session, portal, flags, branding } = result

  // Brama serwerowa, tak samo jak w raportach: ukrycie zakładki to kosmetyka,
  // adres musi być zamknięty też dla wpisanego z ręki. Kanban jest korzeniem
  // portalu, więc przy wyłączonym odsyłamy na pierwszą dostępną zakładkę.
  if (!isTabEnabled(flags, 'kanban')) {
    const fallback = firstEnabledTabPath(flags, slug)
    // Bez tego warunku wszystkie flagi wyłączone dałyby przekierowanie
    // `/${slug}` na `/${slug}`, czyli pętlę.
    if (fallback && fallback !== `/${slug}`) redirect(fallback)
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <p className="text-sm text-muted-foreground text-center">
          Ten portal nie ma teraz włączonej żadnej zakładki.
          <br />
          Napisz do nas na hi@important.is, ustawimy dostęp.
        </p>
      </div>
    )
  }

  const rawTasks = await getAllTasksForFolder(portal.clickupFolderId)
  const snapshots = await getSnapshotMap(portal.id)
  const tasks = mergeTrackedTime(rawTasks, snapshots)

  return (
    <KanbanBoardClient
      initialTasks={tasks}
      slug={slug}
      portalName={portal.name}
      flags={flags}
      branding={branding}
      userEmail={session.email}
    />
  )
}
