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

/**
 * Nazwa hosta, z ktorej realnie przyszlo zadanie — albo null.
 *
 * `Origin` jest wlasciwym naglowkiem, `Referer` to zapas: przegladarki
 * pomijaja `Origin` przy czesci zapytan GET, a wtedy `Referer` jest jedynym
 * sladem strony wywolujacej. Oba sa pelnymi adresami (`https://host/sciezka`),
 * a `site_domains` trzyma same nazwy hostow, wiec porownujemy hosty, nie
 * surowe ciagi — inaczej zaden realny ruch z przegladarki by nie przeszedl.
 */
function requestHostname(request: NextRequest): string | null {
  const raw = request.headers.get('origin') ?? request.headers.get('referer')
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Czy zadanie przyszlo z domeny tego portalu.
 *
 * TO JEST WLASCIWA BRAMA, nie `allowedOrigins` w `createSitepingHandler`.
 * Sprawdzone w skompilowanym pakiecie (`buildCorsHeaders` w `dist/index.js`):
 * `allowedOrigins` decyduje WYLACZNIE o tym, czy odpowiedz dostanie naglowek
 * `Access-Control-Allow-Origin`. Zadanie nie jest przez to odrzucane — curl
 * albo skrypt bez naglowka `Origin` przechodzi tamtedy nietkniety, bo CORS
 * jest mechanizmem przegladarki, a nie serwera.
 *
 * Brak `Origin` I `Referer` to takze odmowa: nic legalnego nie wola tego
 * endpointu spoza przegladarki. PATCH/DELETE swiadomie NIE przechodza przez
 * te brame — tam brama jest inna (`SITEPING_API_KEY`), a klient z tokenem
 * zadnego `Origin` nie wysyla.
 */
function isFromAllowedDomain(request: NextRequest, portal: ResolvedPortal): boolean {
  const hostname = requestHostname(request)
  if (!hostname) return false
  return portal.siteDomains.some(d => d.toLowerCase() === hostname)
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
  if (!isFromAllowedDomain(request, portal)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const key = `${portal.id}:${clientIp(request)}:${limit.bucket}`
  if (!checkRateLimit(key, { max: limit.max, windowMs: 60_000 })) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }

  return null
}

/**
 * Origin do naglowka CORS, jesli wolno go odeslac.
 *
 * `createSitepingHandler` porownuje `allowedOrigins` z naglowkiem `Origin`
 * ZNAK PO ZNAKU, a `site_domains` trzyma same nazwy hostow — podanie ich tam
 * wprost znaczyloby, ze naglowek CORS nie pojawi sie NIGDY i przegladarka
 * zablokowalaby kazda odpowiedz, lacznie z ta dla prawdziwego klienta.
 * Dlatego odsylamy dokladnie ten `Origin`, ktory przyszedl, i tylko wtedy, gdy
 * jego host przeszedl juz nasza wlasna kontrole (`isFromAllowedDomain`).
 */
function corsOrigins(request: NextRequest, portal: ResolvedPortal): string[] {
  const origin = request.headers.get('origin')
  if (!origin || !isFromAllowedDomain(request, portal)) return []
  return [origin]
}

function buildHandler(portal: ResolvedPortal, request: NextRequest): SitepingHandler {
  return createSitepingHandler({
    store: createClickUpSitepingStore(portal),
    allowedOrigins: corsOrigins(request, portal),
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

/** Zapis: tworzy zadanie w ClickUpie, wiec najciasniejszy budzet. */
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params
  return withPortal(
    request,
    slug,
    handler => handler.POST(request),
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
