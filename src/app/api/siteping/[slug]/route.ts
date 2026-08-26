import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createSitepingHandler, type SitepingHandler } from '@siteping/adapter-prisma'
import { db } from '@/lib/db'
import { portals, portalLists } from '@/lib/db/schema'
import { createClickUpSitepingStore } from '@/lib/siteping/store'
import { checkRateLimit } from '@/lib/siteping/rateLimit'
import { clampAnnotationRanges } from '@/lib/siteping/clampPayload'
import { isFromAllowedDomain, corsOrigins } from '@/lib/siteping/origin'
import { logSitepingRequest, outcomeForStatus } from '@/lib/siteping/log'
import { verifyIdentityToken } from '@/lib/siteping/identityToken'

export const runtime = 'nodejs'

interface ResolvedPortal {
  id: string
  slug: string
  name: string
  clickupFolderId: string
  defaultListId: string
  defaultAssigneeId: number | null
  siteDomains: string[]
}

/**
 * Wynik szukania portalu dla sluga.
 *
 * TRZY STANY, NIE DWA, i to jest zmiana wprowadzona razem z logiem
 * diagnostycznym. Odpowiedz na zewnatrz jest dalej ta sama (404 w kazdym
 * przypadku, zeby nie zdradzac istnienia portalu komus, kto zgadl slug), ale
 * po naszej stronie „portalu nie ma" i „portal jest, tylko ma niepelna
 * konfiguracje" to dwie rozne sprawy: tej drugiej mamy do czego przypiac wpis
 * w logu i to ona odpowiada na „czemu klientowi nie dochodza zgloszenia".
 */
type PortalLookup =
  | { kind: 'ready'; portal: ResolvedPortal }
  | { kind: 'incomplete'; portalId: string; reason: string }
  | { kind: 'unknown' }

async function resolvePortal(slug: string): Promise<PortalLookup> {
  const rows = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  const portal = rows[0]
  if (!portal) return { kind: 'unknown' }

  const incomplete = (reason: string): PortalLookup => ({ kind: 'incomplete', portalId: portal.id, reason })

  if (!portal.sitepingEnabled) return incomplete('przełącznik SitePinga jest wyłączony')

  const siteDomains = (portal.siteDomains ?? '').split(',').map(d => d.trim()).filter(Boolean)
  if (siteDomains.length === 0) return incomplete('lista domen jest pusta, endpoint jest zamknięty')

  const lists = await db
    .select()
    .from(portalLists)
    .where(eq(portalLists.portalId, portal.id))
    .orderBy(portalLists.sortOrder)
  const defaultList = lists.find(l => l.isDefault) ?? lists[0]
  if (!defaultList) return incomplete('projekt nie ma listy ClickUp, nie ma gdzie założyć zadania')

  return {
    kind: 'ready',
    portal: {
      id: portal.id,
      slug: portal.slug,
      name: portal.name,
      clickupFolderId: portal.clickupFolderId,
      defaultListId: defaultList.clickupListId,
      defaultAssigneeId: portal.defaultAssigneeId,
      siteDomains,
    },
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

/**
 * Co udalo sie ustalic o przebiegu zadania — do wpisu w logu diagnostycznym.
 *
 * Zbieramy to ze SKLEPU, a nie z cialem odpowiedzi, bo cialo da sie odczytac
 * tylko raz i podgladanie go znaczyloby sklejanie odpowiedzi od nowa przy
 * kazdym zgloszeniu. Poza tym pakiet zwraca zglaszajacemu generyczne
 * „Internal server error" (`actionableErrorMessage` nie przepuszcza tresci),
 * wiec powod awarii istnieje WYLACZNIE tutaj.
 */
interface Trace {
  clickupTaskId: string | null
  error: string | null
}

function tracedStore(store: ReturnType<typeof createClickUpSitepingStore>, trace: Trace) {
  return {
    ...store,
    async createFeedback(...args: Parameters<typeof store.createFeedback>) {
      try {
        const record = await store.createFeedback(...args)
        trace.clickupTaskId = record.id
        return record
      } catch (error) {
        trace.error = error instanceof Error ? error.message : String(error)
        throw error
      }
    },
  }
}

/**
 * Dowod tozsamosci nadawcy, ZAMIAST wiary w pole `authorEmail` z cialka.
 *
 * `sp_token` z linku „Pokaz na stronie" jest juz raz zweryfikowany przez
 * `/api/siteping/identity` (serwer strony klienta), ktora odsyla go
 * NIEZMIENIONEGO w odpowiedzi. Mu-plugin doklada go do configu widgetu jako
 * naglowek `Authorization: Bearer <token>` — jedyny wlasny naglowek, ktory
 * pakiet przepuszcza przez CORS (`Access-Control-Allow-Headers` w
 * `dist/index.js` jest na sztywno `Content-Type, Authorization`).
 *
 * Weryfikujemy go TUTAJ PONOWNIE (podpis, wygasniecie, przypisanie do sluga)
 * zamiast ufac, ze skoro naglowek przyszedl, to znaczy, ze jest prawdziwy —
 * inaczej dowolny POST z reki mogby dolozyc dowolny tekst w `Authorization`
 * i miec to samo prawo co prawdziwy token.
 */
async function resolveVerifiedIdentityEmail(request: NextRequest, slug: string): Promise<string | null> {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  if (!token) return null
  const identity = await verifyIdentityToken(token, slug)
  return identity?.email ?? null
}

async function buildHandler(
  portal: ResolvedPortal,
  request: NextRequest,
  trace: Trace
): Promise<SitepingHandler> {
  return createSitepingHandler({
    store: tracedStore(
      createClickUpSitepingStore({
        ...portal,
        siteOrigin: verifiedSiteOrigin(request, portal),
        verifiedIdentityEmail: await resolveVerifiedIdentityEmail(request, portal.slug),
      }),
      trace
    ),
    allowedOrigins: corsOrigins(request, portal.siteDomains),
    apiKey: process.env.SITEPING_API_KEY,
    // POST: widget submits from an unauthenticated browser. GET: the
    // widget's own panel lists past feedback, also unauthenticated.
    // PATCH/DELETE are deliberately NOT here — see Task 6 Step 2.
    publicEndpoints: ['POST', 'GET', 'OPTIONS'],
  })
}

/**
 * Wpis do logu diagnostycznego dla jednego wyjscia z trasy.
 *
 * BEST-EFFORT i tak jest zbudowany `logSitepingRequest`: zaden blad zapisu nie
 * wraca tutaj, wiec zgloszenie klienta nie zalezy od tego, czy log dziala.
 */
async function zapiszWpis(
  request: NextRequest,
  portalId: string,
  status: number,
  startedAt: number,
  extra: { detail?: string | null; clickupTaskId?: string | null } = {}
): Promise<void> {
  await logSitepingRequest({
    portalId,
    method: request.method,
    status,
    outcome: outcomeForStatus(status),
    // Surowy naglowek, nie wynik naszej walidacji: przy odmowie chodzi
    // wlasnie o to, ZEBY zobaczyc adres, ktory sie nie zgadza z konfiguracja.
    origin: request.headers.get('origin') ?? request.headers.get('referer'),
    ip: clientIp(request),
    durationMs: Date.now() - startedAt,
    detail: extra.detail ?? null,
    clickupTaskId: extra.clickupTaskId ?? null,
  })
}

async function withPortal(
  request: NextRequest,
  slug: string,
  run: (handler: SitepingHandler) => Promise<Response>,
  guard?: (portal: ResolvedPortal) => Response | null
): Promise<Response> {
  const startedAt = Date.now()
  const lookup = await resolvePortal(slug)

  // Slug bez portalu NIE trafia do logu: nie ma projektu, do ktorego mozna by
  // wpis przypiac, a dopisanie go „gdziekolwiek" zanieczyscilo by log
  // przypadkowego klienta zgadywaniem obcego bota.
  if (lookup.kind === 'unknown') return new Response('Not found', { status: 404 })

  if (lookup.kind === 'incomplete') {
    await zapiszWpis(request, lookup.portalId, 404, startedAt, { detail: lookup.reason })
    return new Response('Not found', { status: 404 })
  }

  const portal = lookup.portal
  const blocked = guard?.(portal)
  if (blocked) {
    await zapiszWpis(request, portal.id, blocked.status, startedAt)
    return blocked
  }

  const trace: Trace = { clickupTaskId: null, error: null }
  try {
    const response = await run(await buildHandler(portal, request, trace))
    await zapiszWpis(request, portal.id, response.status, startedAt, {
      clickupTaskId: trace.clickupTaskId,
      // Przy 500 pakiet oddaje zglaszajacemu generyczny komunikat, wiec to
      // jedyne miejsce, w ktorym powod awarii (najczesciej odpowiedz ClickUpa)
      // w ogole istnieje poza konsola serwera.
      detail: response.ok ? null : trace.error,
    })
    return response
  } catch (error) {
    // Most likely cause: SITEPING_API_KEY missing in production (Global
    // Constraints, third bullet) — createSitepingHandler throws
    // synchronously in that case. A 500 here is far better than an
    // unhandled crash with no response at all.
    console.error(`[siteping] handler construction failed for portal ${slug}:`, error)
    await zapiszWpis(request, portal.id, 500, startedAt, {
      detail: error instanceof Error ? error.message : String(error),
    })
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
