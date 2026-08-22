import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { portals, portalLists } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { ensureAdminUser } from '@/lib/adminUser'
import { isSafeLogoUrl, normalizeHexColor } from '@/lib/branding'
import { isPlausibleEmail, normalizePhone } from '@/lib/portalContact'
import { serializeContactMemberIds, TEAM_MEMBERS } from '@/lib/team'
import { serializeAutoTags } from '@/lib/autoTags'

export async function GET(request: NextRequest) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const list = await db
    .select({
      id: portals.id,
      slug: portals.slug,
      name: portals.name,
      isActive: portals.isActive,
      kanbanEnabled: portals.kanbanEnabled,
      reportsEnabled: portals.reportsEnabled,
      historyEnabled: portals.historyEnabled,
      dashboardEnabled: portals.dashboardEnabled,
      sitepingEnabled: portals.sitepingEnabled,
      statusControlsEnabled: portals.statusControlsEnabled,
      estimateReportEnabled: portals.estimateReportEnabled,
      // Potrzebne w adminie do pobrania listy tagów tej przestrzeni ClickUp
      // dla checkboxów autoTags (patrz /api/admin/portals/tags).
      clickupSpaceId: portals.clickupSpaceId,
      autoTags: portals.autoTags,
      siteDomains: portals.siteDomains,
      logoUrl: portals.logoUrl,
      brandColor: portals.brandColor,
      contactMemberIds: portals.contactMemberIds,
      contactName: portals.contactName,
      contactEmail: portals.contactEmail,
      contactPhone: portals.contactPhone,
    })
    .from(portals)
    .orderBy(portals.name)

  return NextResponse.json({ portals: list })
}

const UpdatePortalSchema = z
  .object({
    slug: z.string().min(1).max(50),
    isActive: z.boolean().optional(),
    kanbanEnabled: z.boolean().optional(),
    reportsEnabled: z.boolean().optional(),
    historyEnabled: z.boolean().optional(),
    dashboardEnabled: z.boolean().optional(),
    sitepingEnabled: z.boolean().optional(),
    statusControlsEnabled: z.boolean().optional(),
    estimateReportEnabled: z.boolean().optional(),
    /**
     * Domeny, z których endpoint SitePing przyjmuje zgłoszenia — SAME NAZWY
     * HOSTÓW po przecinku (`wdf.important.is,wodadlafirmy.pl`), bez schematu
     * i bez ścieżki. Porównujemy je z hostem z nagłówka `Origin`/`Referer`,
     * więc wpis ze schematem nigdy by nie pasował. Pusty ciąg czyści pole,
     * a wtedy endpoint wraca do 404 niezależnie od flagi.
     *
     * Walidacja jest TUTAJ, bo /api/admin/* przyjmuje też ADMIN_API_TOKEN,
     * czyli curl omija panel w całości — a to pole jest allowlistą
     * bezpieczeństwa, nie kosmetyką.
     */
    siteDomains: z
      .string()
      .max(500)
      .nullable()
      .optional()
      .transform(v =>
        v === undefined
          ? undefined
          : v === null || v.trim() === ''
            ? null
            : v.split(',').map(d => d.trim().toLowerCase()).filter(Boolean).join(',')
      )
      // `localhost` (bez kropki) przechodzi celowo — to jest domena strony
      // testowej z Task 7 planu.
      //
      // PORT jest dozwolony (`localhost:5500`), bo ten sam wpis buduje link
      // „Pokaż na stronie" w portalu, a link bez portu prowadzi donikąd.
      // Do sprawdzania `Origin` port jest pomijany (patrz `hostOnly`
      // w lib/siteping/origin.ts), więc nie zawęża uprawnień.
      .refine(
        v => v === undefined || v === null || v.split(',').every(d => /^[a-z0-9.-]+(:\d{1,5})?$/.test(d)),
        { message: 'Podaj nazwy hostów po przecinku (opcjonalnie z portem), bez https:// i bez ścieżki' }
      ),
    /**
     * Kolor marki `#rrggbb`, `#rgb` albo bez kratki. Pusty ciąg i null
     * czyszczą pole, wracając do koloru domyślnego portalu.
     *
     * Walidacja jest TUTAJ, a nie tylko w formularzu: /api/admin/* przyjmuje
     * też ADMIN_API_TOKEN, więc curl omija panel w całości. Wartość trafia
     * potem do atrybutu style na stronie klienta.
     */
    brandColor: z
      .string()
      .max(20)
      .nullable()
      .optional()
      .transform(v => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v))
      .refine(v => v === undefined || v === null || normalizeHexColor(v) !== null, {
        message: 'Kolor musi być postaci #rrggbb albo #rgb',
      })
      .transform(v => (v === undefined || v === null ? v : normalizeHexColor(v))),
    /** Adres logo (https, http albo data:image/...). Pusty ciąg czyści. */
    logoUrl: z
      .string()
      .max(200_000)
      .nullable()
      .optional()
      .transform(v => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim()))
      .refine(v => v === undefined || v === null || isSafeLogoUrl(v), {
        message: 'Logo musi być adresem https/http albo obrazkiem data:image/...',
      }),
    /**
     * Kontakt opiekuna, pokazywany na zakładce Dashboard. Puste pole czyści
     * wartość i zakładka spada na zapas agencji (PORTAL_CONTACT_*).
     * Telefon i e-mail walidujemy, bo lądują w atrybutach href.
     */
    /**
     * Kto z zespołu jest kontaktem. Tablica identyfikatorów z lib/team.ts.
     * Pusta tablica to świadome odznaczenie wszystkich i zapisuje się jako
     * pusty ciąg, co jest czymś INNYM niż null (null = domyślnie cały zespół).
     */
    contactMemberIds: z
      .array(z.string().max(40))
      .max(20)
      .optional()
      .refine(
        v => v === undefined || v.every(id => TEAM_MEMBERS.some(m => m.id === id)),
        { message: 'Nieznany członek zespołu' }
      )
      .transform(v => (v === undefined ? undefined : serializeContactMemberIds(v))),
    /**
     * Tagi ClickUp doklejane do zadań z AI-chatu (patrz autoTags w schema.ts).
     * Bez allowlisty jak przy contactMemberIds: zestaw tagów przestrzeni jest
     * per klient i zmienny, checkboxy w PortalConfigForm pokazują tylko to,
     * co realnie istnieje w ClickUpie (getSpaceTags), więc dowolny string tu
     * i tak by ClickUp cicho zignorował przy tworzeniu zadania.
     */
    autoTags: z
      .array(z.string().max(60))
      .max(20)
      .optional()
      .transform(v => (v === undefined ? undefined : serializeAutoTags(v))),
    contactName: z
      .string()
      .max(120)
      .nullable()
      .optional()
      .transform(v => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim())),
    contactEmail: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .transform(v => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim()))
      .refine(v => v === undefined || v === null || isPlausibleEmail(v), { message: 'Niepoprawny adres e-mail' }),
    contactPhone: z
      .string()
      .max(32)
      .nullable()
      .optional()
      .transform(v => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim()))
      .refine(v => v === undefined || v === null || normalizePhone(v) !== null, {
        message: 'Numer może zawierać tylko cyfry, +, spacje, myślniki i nawiasy',
      }),
  })
  .strict()

/**
 * Przełączanie flag portalu. Osobno od POST, bo POST tworzy portal razem
 * z listami, a tu chodzi o jedno pole.
 *
 * Każda zakładka poza kanbanem startuje wyłączona i włącza się tutaj,
 * z /admin albo curlem z tokenem:
 *   curl -X PATCH .../api/admin/portals -H "Authorization: Bearer $ADMIN_API_TOKEN" \
 *        -d '{"slug":"onyx","reportsEnabled":true,"historyEnabled":true}'
 *   curl -X PATCH .../api/admin/portals -H "Authorization: Bearer $ADMIN_API_TOKEN" \
 *        -d '{"slug":"onyx","brandColor":"#c8a24a","logoUrl":"https://onyx.wroclaw.pl/logo.png"}'
 *
 * SitePing wymaga OBU pól naraz — sama flaga bez domen zostawia endpoint na
 * 404, bo nie ma z czym porównać nagłówka Origin:
 *   curl -X PATCH .../api/admin/portals -H "Authorization: Bearer $ADMIN_API_TOKEN" \
 *        -d '{"slug":"wdf","sitepingEnabled":true,"siteDomains":"wdf.important.is,wodadlafirmy.pl"}'
 *
 * Zod ma `.strict()`, więc nieznane pole daje 400 zamiast cichego pominięcia.
 */
export async function PATCH(request: NextRequest) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = UpdatePortalSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { slug, ...raw } = parsed.data

  // Druga linia obrony po błędzie, w którym transformacja Zoda zamieniała
  // NIEOBECNE pole na null, a `set()` sumiennie zerowało kolor, logo i kontakt
  // przy każdym przełączeniu zwykłej flagi. Do bazy idą wyłącznie klucze,
  // które klient faktycznie przysłał. `null` jest wartością znaczącą
  // (wyczyść pole), `undefined` znaczy „nie dotykaj".
  const changes = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined)
  )

  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: 'Brak pól do zmiany' }, { status: 400 })
  }

  const [portal] = await db
    .update(portals)
    .set(changes)
    .where(eq(portals.slug, slug))
    .returning({
      id: portals.id,
      slug: portals.slug,
      name: portals.name,
      isActive: portals.isActive,
      kanbanEnabled: portals.kanbanEnabled,
      reportsEnabled: portals.reportsEnabled,
      historyEnabled: portals.historyEnabled,
      dashboardEnabled: portals.dashboardEnabled,
      sitepingEnabled: portals.sitepingEnabled,
      statusControlsEnabled: portals.statusControlsEnabled,
      estimateReportEnabled: portals.estimateReportEnabled,
      // Potrzebne w adminie do pobrania listy tagów tej przestrzeni ClickUp
      // dla checkboxów autoTags (patrz /api/admin/portals/tags).
      clickupSpaceId: portals.clickupSpaceId,
      autoTags: portals.autoTags,
      siteDomains: portals.siteDomains,
      logoUrl: portals.logoUrl,
      brandColor: portals.brandColor,
      contactMemberIds: portals.contactMemberIds,
      contactName: portals.contactName,
      contactEmail: portals.contactEmail,
      contactPhone: portals.contactPhone,
    })

  if (!portal) return NextResponse.json({ error: 'Portal nie istnieje' }, { status: 404 })

  return NextResponse.json({ portal })
}

const CreatePortalSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Tylko małe litery, cyfry i myślniki'),
  clickupFolderUrl: z.string().url().optional(),
  clickupFolderId: z.string().min(1),
  clickupSpaceId: z.string().optional().default('90100136256'),
  lists: z.array(z.object({
    clickupListId: z.string().min(1),
    displayName: z.string().min(1),
    isDefault: z.boolean().default(false),
  })).min(1, 'Podaj przynajmniej jedną listę'),
})

export async function POST(request: NextRequest) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  // Auto-extract folder ID from ClickUp URL if provided
  if (body.clickupFolderUrl && !body.clickupFolderId) {
    const match = body.clickupFolderUrl.match(/\/f\/(\d+)/)
    if (match) body.clickupFolderId = match[1]
  }

  const parsed = CreatePortalSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { name, slug, clickupFolderId, clickupSpaceId, lists } = parsed.data

  const [portal] = await db
    .insert(portals)
    .values({ name, slug, clickupFolderId, clickupSpaceId: clickupSpaceId ?? '90100136256' })
    .onConflictDoNothing()
    .returning()

  if (!portal) {
    return NextResponse.json({ error: 'Portal z tym slugiem już istnieje' }, { status: 409 })
  }

  for (let i = 0; i < lists.length; i++) {
    await db.insert(portalLists).values({
      portalId: portal.id,
      clickupListId: lists[i].clickupListId,
      displayName: lists[i].displayName,
      isDefault: i === 0 ? true : lists[i].isDefault,
      sortOrder: i,
    })
  }

  // Admin ma konto w każdym projekcie od momentu jego powstania, nie dopiero
  // po pierwszym ręcznym logowaniu.
  await ensureAdminUser(portal.id)

  return NextResponse.json({ portal }, { status: 201 })
}
