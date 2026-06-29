import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // Verify portal exists and is active
  const portal = await db
    .select()
    .from(portals)
    .where(and(eq(portals.slug, slug), eq(portals.isActive, true)))
    .limit(1)

  if (!portal[0]) redirect('/')

  return <>{children}</>
}
