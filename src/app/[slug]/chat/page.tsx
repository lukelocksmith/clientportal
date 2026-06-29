import { redirect } from 'next/navigation'

// Chat is now an inline popup on the kanban board — this route is no longer used.
export default async function ChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  redirect(`/${slug}`)
}
