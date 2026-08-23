import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdminRequest } from '@/lib/admin-auth'
import { requireAdminPortal } from '@/lib/adminPortal'
import { MAX_LINKS_PER_PORTAL, MAX_LABEL_LENGTH } from '@/lib/projectLinks'
import { getProjectLinks, replaceProjectLinks } from '@/lib/projectLinksStore'

/**
 * Linki projektu pokazywane klientowi na Dashboardzie.
 *
 * PUT podmienia caly zestaw, bo panel wysyla pelna liste po edycji.
 * Niepoprawne i puste wiersze sa odrzucane po cichu w sanitizeLinks: panel
 * pozwala dodac pusty wiersz i to normalne, ze czesc zostanie niewypelniona.
 * Odpowiedz zwraca to, co RZECZYWISCIE zapisano, wiec panel widzi, ile wierszy
 * przeszlo.
 */
const schema = z.object({
  slug: z.string().min(1).max(50),
  links: z
    .array(
      z.object({
        label: z.string().max(MAX_LABEL_LENGTH),
        url: z.string().max(500),
      })
    )
    .max(MAX_LINKS_PER_PORTAL + 5),
})

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const slug = request.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Podaj slug' }, { status: 400 })

  const gate = await requireAdminPortal(slug)
  if (!gate.ok) return gate.response

  return NextResponse.json({ links: await getProjectLinks(gate.portal.id) })
}

export async function PUT(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const gate = await requireAdminPortal(parsed.data.slug)
  if (!gate.ok) return gate.response

  const saved = await replaceProjectLinks(gate.portal.id, parsed.data.links)
  return NextResponse.json({ ok: true, saved, links: await getProjectLinks(gate.portal.id) })
}
