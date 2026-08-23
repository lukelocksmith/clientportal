import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals } from '@/lib/db/schema'
import { verifyToken } from '@/lib/apiAuth'
import { syncPortalIndex, type SyncResult } from '@/lib/taskIndex'
import { recordCronRun } from '@/lib/cronRuns'
import { acquireCronLock } from '@/lib/cronLock'

export const dynamic = 'force-dynamic'
// Przebieg treści woła ClickUpa z przerwami, więc trwa dziesiątki sekund.
export const maxDuration = 300

/**
 * Synchronizacja lustra zadań (tabela `task_index`) pod zakładkę Historia
 * i wyszukiwarkę. Auth: `Authorization: Bearer <CRON_SECRET>` albo `?token=`.
 *
 * Parametry:
 *   ?slug=onyx     — tylko jeden projekt (domyślnie wszystkie aktywne)
 *   ?budget=40     — ile zadań doczytać (komentarze + załączniki) w tym wywołaniu
 *   ?force=1       — przebudowa treści WSZYSTKICH zadań, ignoruje contentSyncedAt
 *
 * Budżet zamiast skryptu z laptopa: pierwszy przebieg dla projektu z setką
 * zadań nie zmieści się w jednym żądaniu, bo między wywołaniami ClickUpa jest
 * przerwa na limit zapytań. Zamiast celować produkcyjną bazą ze skryptu,
 * odpalamy tę trasę kilka razy tym samym tokenem, aż `contentPending` spadnie
 * do zera. Jest idempotentna i wznawialna.
 *
 * Zalecany harmonogram:
 *   codziennie   — bez parametrów (przyrostowo, tanio)
 *   raz w tygodniu — z `force=1`
 *
 * `force=1` jest OBOWIĄZKOWY, nie kosmetyczny. Gdy ktoś zdejmie prefiks
 * [PUBLIC] z komentarza w ClickUpie, `date_updated` zadania niekoniecznie się
 * rusza. Przebieg przyrostowy przeoczyłby taką zmianę, a wycofana treść
 * zostałaby w przeszukiwalnym indeksie klienta na zawsze.
 */
async function handle(request: NextRequest) {
  if (!verifyToken(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const lock = await acquireCronLock('task-index')
  if (lock.kind === 'busy') {
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      skipped: 'inny przebieg task-index trwa',
    })
  }
  if (lock.kind === 'acquired') {
    try {
      return await runIndex(request)
    } finally {
      await lock.release()
    }
  }
  return runIndex(request)
}

async function runIndex(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams
  const onlySlug = params.get('slug')
  const budgetRaw = Number(params.get('budget'))
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.min(budgetRaw, 500) : 40
  const forceContent = params.get('force') === '1' || params.get('force') === 'true'

  const rows = await db
    .select({
      id: portals.id,
      slug: portals.slug,
      clickupFolderId: portals.clickupFolderId,
    })
    .from(portals)
    .where(eq(portals.isActive, true))

  const targets = onlySlug ? rows.filter(r => r.slug === onlySlug) : rows
  if (onlySlug && targets.length === 0) {
    return NextResponse.json({ error: `Portal ${onlySlug} nie istnieje albo jest nieaktywny` }, { status: 404 })
  }

  const results: Array<{ slug: string; ok: boolean; error?: string } & Partial<SyncResult>> = []

  for (const portal of targets) {
    const startedAt = new Date()
    try {
      const result = await syncPortalIndex(portal, { budget, forceContent })
      results.push({ slug: portal.slug, ok: true, ...result })

      // Ucięty pobór to nie awaria synchronizacji, ale znaczy, że rekoncyliacja
      // się nie wykonała, więc zespół musi o tym wiedzieć.
      await recordCronRun({
        job: 'task-index',
        portalId: portal.id,
        portalSlug: portal.slug,
        ok: !result.truncated,
        itemsProcessed: result.upserted,
        detail: result.truncated
          ? `Pobór z ClickUpa UCIĘTY, rekoncyliacja pominięta. Zadań: ${result.fetched}`
          : `zadań: ${result.fetched}, treść: ${result.contentSynced}, czeka: ${result.contentPending}, usunięto: ${result.deleted}`,
        startedAt,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      results.push({ slug: portal.slug, ok: false, error: message })
      await recordCronRun({
        job: 'task-index',
        portalId: portal.id,
        portalSlug: portal.slug,
        ok: false,
        detail: message,
        startedAt,
      })
    }
  }

  const pending = results.reduce((sum, r) => sum + (r.contentPending ?? 0), 0)

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    budget,
    forceContent,
    // Gdy > 0, odpal tę trasę ponownie. Backfill jest wznawialny.
    contentPendingTotal: pending,
    portals: results,
  })
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
