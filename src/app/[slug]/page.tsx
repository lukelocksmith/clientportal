import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getAllTasksForFolder } from '@/lib/clickup'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { KanbanBoardClient } from '@/components/kanban/KanbanBoardClient'

export const revalidate = 60 // Revalidate every 60s, webhooks invalidate sooner

interface PortalPageProps {
  params: Promise<{ slug: string }>
}

export default async function PortalPage({ params }: PortalPageProps) {
  const { slug } = await params

  const session = await getSession()
  if (!session || session.portalSlug !== slug) {
    redirect(`/${slug}/login`)
  }

  const portal = await db
    .select()
    .from(portals)
    .where(eq(portals.slug, slug))
    .limit(1)

  if (!portal[0]) redirect('/')

  const tasks = await getAllTasksForFolder(portal[0].clickupFolderId)

  return (
    <KanbanBoardClient
      initialTasks={tasks}
      slug={slug}
      portalName={portal[0].name}
      userEmail={session.email}
    />
  )
}
