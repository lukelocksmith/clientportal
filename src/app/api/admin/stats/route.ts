import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { aiUsage, portals } from '@/lib/db/schema'
import { sql, eq, desc } from 'drizzle-orm'

// Aggregated AI token usage + cost for the admin panel: totals and breakdowns
// by project, user, and model. Auth: admin cookie session OR ADMIN_API_TOKEN.
export async function GET(request: NextRequest) {
  if (!await isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const agg = {
    calls: sql<number>`count(*)::int`,
    inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)::float8`,
    outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)::float8`,
    totalTokens: sql<number>`coalesce(sum(${aiUsage.totalTokens}),0)::float8`,
    costUsd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8`,
  }

  const [totals] = await db.select(agg).from(aiUsage)

  const byProject = await db
    .select({
      portalId: aiUsage.portalId,
      slug: portals.slug,
      name: portals.name,
      // Kiedy ostatnio ktokolwiek w tym projekcie uzyl czatu. Bez tego nie da
      // sie odroznic "projekt nie uzywa AI" od "projekt uzywal poltora miesiaca
      // temu i przestal", a to inna informacja.
      lastUsedAt: sql<string | null>`max(${aiUsage.createdAt})`,
      ...agg,
    })
    .from(aiUsage)
    .leftJoin(portals, eq(aiUsage.portalId, portals.id))
    .groupBy(aiUsage.portalId, portals.slug, portals.name)
    .orderBy(desc(sql`sum(${aiUsage.costUsd})`))

  const byUser = await db
    .select({ userEmail: aiUsage.userEmail, ...agg })
    .from(aiUsage)
    .groupBy(aiUsage.userEmail)
    .orderBy(desc(sql`sum(${aiUsage.costUsd})`))

  const byModel = await db
    .select({ provider: aiUsage.provider, model: aiUsage.model, ...agg })
    .from(aiUsage)
    .groupBy(aiUsage.provider, aiUsage.model)
    .orderBy(desc(sql`sum(${aiUsage.costUsd})`))

  // Rozbicia z kluczem projektu, zeby panel mogl pokazac zuzycie W OBREBIE
  // jednego projektu. Istniejace byUser i byModel zostaja globalne i nietkniete,
  // bo widok ogolny na gorze panelu nadal z nich czyta.
  //
  // Wszystko jednym zadaniem, zamiast dociagania po otwarciu zakladki: przy
  // kilkunastu portalach i kilku modelach to kilkadziesiat wierszy, wiec osobny
  // endpoint per projekt bylby zlozonoscia bez zysku.
  const byProjectUser = await db
    .select({ portalId: aiUsage.portalId, userEmail: aiUsage.userEmail, ...agg })
    .from(aiUsage)
    .groupBy(aiUsage.portalId, aiUsage.userEmail)
    .orderBy(desc(sql`sum(${aiUsage.costUsd})`))

  const byProjectModel = await db
    .select({ portalId: aiUsage.portalId, provider: aiUsage.provider, model: aiUsage.model, ...agg })
    .from(aiUsage)
    .groupBy(aiUsage.portalId, aiUsage.provider, aiUsage.model)
    .orderBy(desc(sql`sum(${aiUsage.costUsd})`))

  return NextResponse.json({ totals, byProject, byUser, byModel, byProjectUser, byProjectModel })
}
