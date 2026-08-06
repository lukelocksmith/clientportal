import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createSitepingHandler, type SitepingHandler } from '@siteping/adapter-prisma'
import { db } from '@/lib/db'
import { portals, portalLists } from '@/lib/db/schema'
import { createClickUpSitepingStore } from '@/lib/siteping/store'
import { checkRateLimit } from '@/lib/siteping/rateLimit'
import { clampAnnotationRanges } from '@/lib/siteping/clampPayload'
import { isFromAllowedDomain, corsOrigins } from '@/lib/siteping/origin'

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

/**
 * Wspolna brama publicznych metod: najpierw domena, potem czestotliwosc.
 *
 * W tej kolejnosci naumyslnie — ruch spoza dozwolonej domeny nie ma prawa
 * zjadac budzetu, ktory nalezy do realnego odwiedzajacego z tego samego IP
 * (np. za wspolnym NAT-em firmy klienta).
 *
 * Kubelki GET i POST sa ROZDZIELNE. Jedna wizyta to zwykle kilka odczytow
 * panelu i zero albo jeden zapis, wiec wspolny licznik albo dusilby odczyty,
 * albo rozluznial zapisy — a to zapis tworzy zadania w ClickUpie.
 */
function publicGuard(
  request: NextRequest,
  portal: ResolvedPortal,
  limit: { bucket: string; max: number }
): Response | null {
  if (!isFromAllowedDomain(request, portal.siteDomains)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const key = `${portal.id}:${clientIp(request)}:${limit.bucket}`
  if (!checkRateLimit(key, { max: limit.max, windowMs: 60_000 })) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }

  return null
}

/**
 * Origin zadania, ale WYLACZNIE gdy przeszedl juz kontrole domeny.
 *
 * Trafia do opisu zadania jako podstawa klikalnego linku, wiec nie moze
 * pochodzic z niesprawdzonego naglowka — inaczej obcy nadawca wstawialby
 * zespolowi dowolny adres do klikniecia w ClickUpie.
 */
function verifiedSiteOrigin(request: NextRequest, portal: ResolvedPortal): string | null {
  const [origin] = corsOrigins(request, portal.siteDomains)
  return origin ?? null
}

function buildHandler(portal: ResolvedPortal, request: NextRequest): SitepingHandler {
  return createSitepingHandler({
    store: createClickUpSitepingStore({
      ...portal,
      siteOrigin: verifiedSiteOrigin(request, portal),
    }),
    allowedOrigins: corsOrigins(request, portal.siteDomains),
    apiKey: process.env.SITEPING_API_KEY,
    // POST: widget submits from an unauthenticated browser. GET: the
    // widget's own panel lists past feedback, also unauthenticated.
    // PATCH/DELETE are deliberately NOT here — see Task 6 Step 2.
    publicEndpoints: ['POST', 'GET', 'OPTIONS'],
  })
}

async function withPortal(
  request: NextRequest,
  slug: string,
  run: (handler: SitepingHandler) => Promise<Response>,
  guard?: (portal: ResolvedPortal) => Response | null
): Promise<Response> {
  const portal = await resolvePortal(slug)
  if (!portal) return new Response('Not found', { status: 404 })

  const blocked = guard?.(portal)
  if (blocked) return blocked

  try {
    return await run(buildHandler(portal, request))
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

/**
 * Zadanie z anotacjami sprowadzonymi do zakresow adaptera.
 *
 * Widget potrafi przyslac ulamki spoza [0,1] przy zwyklym przeciagnieciu poza
 * krawedz elementu, a adapter odrzuca wtedy CALE zgloszenie — szczegoly i dowod
 * w `clampPayload.ts`. Przycinamy tutaj, na wejsciu, zeby dalej plynal payload,
 * ktory walidacja pakietu przyjmuje.
 *
 * Cialo zadania da sie odczytac tylko raz, wiec skladamy nowe `Request` z tymi
 * samymi naglowkami. Payload nie bedacy JSON-em przepuszczamy nietkniety —
 * odpowiedz na to nalezy do walidacji adaptera, nie do nas.
 */
async function withClampedAnnotations(request: NextRequest): Promise<Request> {
  const raw = await request.text()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: raw,
    })
  }

  return new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(clampAnnotationRanges(parsed)),
  })
}

/** Zapis: tworzy zadanie w ClickUpie, wiec najciasniejszy budzet. */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(
    request,
    slug,
    async handler => handler.POST(await withClampedAnnotations(request)),
    portal => publicGuard(request, portal, { bucket: 'post', max: 10 })
  )
}

/**
 * Odczyt panelu widgetu. Luzniejszy budzet niz POST, bo jedna uczciwa wizyta
 * generuje kilka odczytow (otwarcie panelu, nawigacja SPA), a zaden z nich
 * nie tworzy zadania.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(
    request,
    slug,
    handler => handler.GET(request),
    portal => publicGuard(request, portal, { bucket: 'get', max: 30 })
  )
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(request, slug, handler => handler.PATCH(request))
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(request, slug, handler => handler.DELETE(request))
}

export async function OPTIONS(request: NextRequest, { params }: Params) {
  const { slug } = await params
  // Preflight NIE przechodzi przez `publicGuard`: przegladarka wysyla go
  // zanim wysle wlasciwe zadanie, a odmowa na tym etapie zablokowalaby
  // rowniez ruch z dozwolonej domeny. Dla obcej domeny odpowiedz i tak
  // wyjdzie bez naglowkow CORS (`corsOrigins` zwroci pusta liste), wiec
  // przegladarka zatrzyma sprawe u siebie, a wlasciwe zadanie i tak
  // trafiloby na 403.
  //
  // Unlike POST/GET/PATCH/DELETE, `SitepingHandler.OPTIONS` is typed
  // synchronous (`(request: Request) => Response`, verified against the
  // installed package) — `withPortal` expects `Promise<Response>`, so wrap it.
  return withPortal(request, slug, handler => Promise.resolve(handler.OPTIONS(request)))
}
