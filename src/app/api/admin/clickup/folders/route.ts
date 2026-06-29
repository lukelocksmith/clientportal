import { NextResponse } from 'next/server'
import { getAdminSession } from '@/lib/admin-auth'

const CLICKUP_TOKEN = process.env.CLICKUP_API_TOKEN
const SPACE_ID = process.env.CLICKUP_SPACE_ID ?? '90100136256'

export async function GET() {
  if (!await getAdminSession()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const res = await fetch(`https://api.clickup.com/api/v2/space/${SPACE_ID}/folder?archived=false`, {
    headers: { Authorization: CLICKUP_TOKEN! },
    next: { revalidate: 60 },
  })
  const data = await res.json()
  const folders = (data.folders ?? []).map((f: { id: string; name: string }) => ({ id: f.id, name: f.name }))
  return NextResponse.json({ folders })
}
