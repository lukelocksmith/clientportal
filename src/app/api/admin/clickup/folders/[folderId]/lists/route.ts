import { NextResponse, NextRequest } from 'next/server'
import { getAdminSession } from '@/lib/admin-auth'

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN

export async function GET(_: NextRequest, { params }: { params: Promise<{ folderId: string }> }) {
  if (!await getAdminSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { folderId } = await params
  const res = await fetch(`https://api.clickup.com/api/v2/folder/${folderId}/list?archived=false`, {
    headers: { Authorization: CLICKUP_TOKEN! },
    next: { revalidate: 60 },
  })
  const data = await res.json()
  const lists = (data.lists ?? []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name }))
  return NextResponse.json({ lists })
}
