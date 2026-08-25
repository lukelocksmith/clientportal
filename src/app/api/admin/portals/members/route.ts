import { NextRequest, NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { getWorkspaceMembers } from '@/lib/clickup'

/**
 * Osoby z workspace ClickUpa — źródło wyboru „kogo przypisywać do zadań"
 * w PortalConfigForm.
 *
 * Admin wybiera z tego, co NAPRAWDĘ istnieje w ClickUpie, tak samo jak przy
 * tagach. Różnica jest jednak istotna: id osoby spoza workspace kończy się
 * błędem CAŁEGO żądania tworzenia zadania, nie cichym pominięciem jak przy
 * tagu. Wpisana z ręki literówka zablokowałaby więc zakładanie zgłoszeń.
 */
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const members = await getWorkspaceMembers()
    return NextResponse.json({ members })
  } catch (error) {
    console.error('[admin/portals/members] ClickUp nie odpowiedział:', error)
    return NextResponse.json({ error: 'ClickUp nie odpowiedział' }, { status: 502 })
  }
}
