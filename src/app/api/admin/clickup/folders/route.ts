import { NextResponse, NextRequest } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { getFoldersInSpace } from '@/lib/clickup'
import { DEFAULT_SPACE_ID } from '@/lib/clickupSpace'

export async function GET(request: NextRequest) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Przez wspólnego klienta ClickUpa: timeout, ponowienia i czytelny błąd
  // zamiast cichej pustej listy w panelu przy awarii API.
  try {
    const folders = await getFoldersInSpace(DEFAULT_SPACE_ID())
    return NextResponse.json({ folders })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[admin/folders] nie udało się pobrać folderów:', message)
    return NextResponse.json({ error: 'Nie udało się pobrać folderów z ClickUpa' }, { status: 502 })
  }
}
