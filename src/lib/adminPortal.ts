import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { portals } from './db/schema'

/**
 * Portal po slugu, dla tras panelu admina.
 *
 * Lookup + obsługa braku powtarzały się ręcznie w ośmiu trasach; każda kopia
 * to szansa na rozjazd komunikatu albo statusu. Brak sluga i nieznany slug
 * dają ten sam 404: dla admina różnica nie niesie informacji, a trasy i tak
 * traktowały oba przypadki jednakowo (warunek `where(eq(slug, null))` nigdy
 * nic nie zwróci).
 */
export type RequireAdminPortal =
  | { ok: true; portal: typeof portals.$inferSelect }
  | { ok: false; response: NextResponse }

export async function requireAdminPortal(slug: string | null | undefined): Promise<RequireAdminPortal> {
  if (!slug) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Portal nie istnieje' }, { status: 404 }),
    }
  }

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Portal nie istnieje' }, { status: 404 }),
    }
  }

  return { ok: true, portal }
}
