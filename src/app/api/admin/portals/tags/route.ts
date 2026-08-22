import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdminRequest } from '@/lib/admin-auth'
import { getSpaceTags } from '@/lib/clickup'

/**
 * Tagi dostępne w przestrzeni ClickUp klienta — źródło checkboxów w
 * PortalConfigForm przy wyborze `autoTags`. Admin wybiera z tego, co
 * NAPRAWDĘ istnieje w ClickUpie, żeby nie dało się zapisać literówki, której
 * ClickUp i tak by cicho nie zastosował (patrz komentarz w lib/clickup.ts).
 */
const QuerySchema = z.object({ spaceId: z.string().min(1) })

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = QuerySchema.safeParse({ spaceId: request.nextUrl.searchParams.get('spaceId') })
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  try {
    const tags = await getSpaceTags(parsed.data.spaceId)
    return NextResponse.json({ tags })
  } catch (error) {
    console.error('[admin/portals/tags] ClickUp nie odpowiedział:', error)
    return NextResponse.json({ error: 'ClickUp nie odpowiedział' }, { status: 502 })
  }
}
