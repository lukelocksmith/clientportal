import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createSitepingHandler, type SitepingHandler } from '@siteping/adapter-prisma'
import { db } from '@/lib/db'
import { portals, portalLists } from '@/lib/db/schema'
import { createClickUpSitepingStore } from '@/lib/siteping/store'
import { checkRateLimit } from '@/lib/siteping/rateLimit'

export const runtime = 'nodejs'

interface ResolvedPortal {
  id: string
  slug: string
  name: string
  clickupFolderId: string
  defaultListId: string
  siteDomains: string[]
}

/**
 * Portal utworzony przez SitePing (flaga + domeny + domyslna lista) albo
 * null — kazdy null-case konczy sie 404, nie 403, zeby nie zdradzac
 * istnienia portalu komus, kto zna/zgadnie slug.
 */
async function resolvePortal(slug: string): Promise<ResolvedPortal | null> {
  const rows = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  const portal = rows[0]
  if (!portal || !portal.sitepingEnabled || !portal.siteDomains) return null

  const siteDomains = portal.siteDomains.split(',').map(d => d.trim()).filter(Boolean)
  if (siteDomains.length === 0) return null

  const lists = await db
    .select()
    .from(portalLists)
    .where(eq(portalLists.portalId, portal.id))
    .orderBy(portalLists.sortOrder)
  const defaultList = lists.find(l => l.isDefault) ?? lists[0]
  if (!defaultList) return null

  return {
    id: portal.id,
    slug: portal.slug,
    name: portal.name,
    clickupFolderId: portal.clickupFolderId,
    defaultListId: defaultList.clickupListId,
    siteDomains,
  }
}

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

function buildHandler(portal: ResolvedPortal): SitepingHandler {
  return createSitepingHandler({
    store: createClickUpSitepingStore(portal),
    allowedOrigins: portal.siteDomains,
    apiKey: process.env.SITEPING_API_KEY,
    // POST: widget submits from an unauthenticated browser. GET: the
    // widget's own panel lists past feedback, also unauthenticated.
    // PATCH/DELETE are deliberately NOT here — see Task 6 Step 2.
    publicEndpoints: ['POST', 'GET', 'OPTIONS'],
  })
}

async function withPortal(
  slug: string,
  run: (handler: SitepingHandler) => Promise<Response>
): Promise<Response> {
  const portal = await resolvePortal(slug)
  if (!portal) return new Response('Not found', { status: 404 })

  try {
    return await run(buildHandler(portal))
  } catch (error) {
    // Most likely cause: SITEPING_API_KEY missing in production (Global
    // Constraints, third bullet) — createSitepingHandler throws
    // synchronously in that case. A 500 here is far better than an
    // unhandled crash with no response at all.
    console.error(`[siteping] handler construction failed for portal ${slug}:`, error)
    return Response.json({ error: 'SitePing misconfigured' }, { status: 500 })
  }
}

type Params = { params: Promise<{ slug: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params
  const portal = await resolvePortal(slug)
  if (!portal) return new Response('Not found', { status: 404 })

  if (!checkRateLimit(`${portal.id}:${clientIp(request)}`, { max: 10, windowMs: 60_000 })) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }

  return withPortal(slug, handler => handler.POST(request))
}

export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(slug, handler => handler.GET(request))
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(slug, handler => handler.PATCH(request))
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(slug, handler => handler.DELETE(request))
}

export async function OPTIONS(request: NextRequest, { params }: Params) {
  const { slug } = await params
  // Unlike POST/GET/PATCH/DELETE, `SitepingHandler.OPTIONS` is typed
  // synchronous (`(request: Request) => Response`, verified against the
  // installed package) — `withPortal` expects `Promise<Response>`, so wrap it.
  return withPortal(slug, handler => Promise.resolve(handler.OPTIONS(request)))
}
