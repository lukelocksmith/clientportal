import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getAllTasksForFolder } from '@/lib/clickup'
import { getSnapshotMap, mergeTrackedTime } from '@/lib/timeSnapshots'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { KanbanBoardClient } from '@/components/kanban/KanbanBoardClient'
import { firstEnabledTabPath, isTabEnabled, type PortalFlags } from '@/lib/portalTabs'
import { resolveBranding } from '@/lib/branding'

export const revalidate = 60 // Revalidate every 60s, webhooks invalidate sooner

interface PortalPageProps {
  params: Promise<{ slug: string }>
}

export default async function PortalPage({ params }: PortalPageProps) {
  const { slug } = await params

  const session = await getSession(slug)
  if (!session || session.portalSlug !== slug) {
    redirect(`/${slug}/login`)
  }

  const portal = await db
    .select()
    .from(portals)
    .where(eq(portals.slug, slug))
    .limit(1)

  if (!portal[0]) redirect('/')

  const flags: PortalFlags = {
    kanbanEnabled: portal[0].kanbanEnabled,
    reportsEnabled: portal[0].reportsEnabled,
    historyEnabled: portal[0].historyEnabled,
    dashboardEnabled: portal[0].dashboardEnabled,
  }

  const branding = resolveBranding(portal[0])

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

  const rawTasks = await getAllTasksForFolder(portal[0].clickupFolderId)
  const snapshots = await getSnapshotMap(portal[0].id)
  const tasks = mergeTrackedTime(rawTasks, snapshots)

  return (
    <KanbanBoardClient
      initialTasks={tasks}
      slug={slug}
      portalName={portal[0].name}
      flags={flags}
      branding={branding}
      userEmail={session.email}
    />
  )
}
