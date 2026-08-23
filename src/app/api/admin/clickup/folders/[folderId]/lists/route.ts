import { NextResponse, NextRequest } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { getFolderLists } from '@/lib/clickup'

export async function GET(request: NextRequest, { params }: { params: Promise<{ folderId: string }> }) {
  if (!await isAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { folderId } = await params
  // Przez wspólnego klienta ClickUpa: timeout, ponowienia i czytelny błąd
  // zamiast cichej pustej listy w panelu przy awarii API.
  try {
    const lists = await getFolderLists(folderId)
    return NextResponse.json({ lists })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[admin/folders] nie udało się pobrać list folderu ${folderId}:`, message)
    return NextResponse.json({ error: 'Nie udało się pobrać list z ClickUpa' }, { status: 502 })
  }
}
