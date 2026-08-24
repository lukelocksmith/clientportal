import { readJson } from '@/lib/apiJson'
import { NextRequest, NextResponse } from 'next/server'
import { getTaskComments, addComment, getTask } from '@/lib/clickup'
import { getPortalScope } from '@/lib/portalScopeStore'
import { taskBelongsToPortal } from '@/lib/portalScope'
import { getIndexedTaskNames } from '@/lib/taskIndex'
import { collectTaskMentions, applyTaskMentions, resolveTaskMentions } from '@/lib/commentMentions'
import { requirePortalApi, requireTaskInPortal } from '@/lib/apiSession'
import { filterPublicComments, buildOwnComment, PUBLIC_PREFIX } from '@/lib/publicComments'
import { logEvent, getOwnedCommentIds, EVENT_COMMENT_ADDED } from '@/lib/portalEvents'
import { sortOldestFirst } from '@/lib/utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response
  const { session, portal } = gate

  const { taskId } = await params
  const scope = await requireTaskInPortal(taskId, gate.portal)
  if (!scope.ok) return scope.response

  const comments = await getTaskComments(taskId)
  // Reguła [PUBLIC] żyje w lib/publicComments.ts, bo ma dwóch konsumentów:
  // tę trasę i indekser Historii. Patrz komentarz w tamtym pliku.
  const visible = sortOldestFirst(filterPublicComments(comments))
  // isOwn steruje przyciskami edycji/usuwania w szufladzie — tylko przy
  // komentarzach, które ten adres sam dodał z portalu.
  const ownedIds = await getOwnedCommentIds(portal.id, session.email, visible.map(c => c.id))

  /**
   * Wzmianki o zadaniach: z identyfikatora na nazwę, ale TYLKO dla zadań z
   * tego portalu. Rozstrzyga to serwer, więc nazwa cudzego zadania nie wychodzi
   * do przeglądarki wcale (patrz lib/commentMentions.ts). Rozwiązujemy naraz
   * dla całego wątku, bo wzmianki się powtarzają.
   */
  const mentioned = collectTaskMentions(visible.flatMap(c => c.blocks ?? []))
  const names = await resolveTaskMentions(mentioned, {
    indexed: ids => getIndexedTaskNames(portal.id, ids),
    live: async id => {
      const [task, scope] = await Promise.all([getTask(id), getPortalScope(portal.id)])
      return taskBelongsToPortal(task, portal.clickupFolderId, scope) ? { name: task.name } : null
    },
  })

  return NextResponse.json({
    comments: visible.map(c => ({
      ...c,
      isOwn: ownedIds.has(c.id),
      blocks: c.blocks ? applyTaskMentions(c.blocks, names) : undefined,
    })),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const gate = await requirePortalApi(request.nextUrl.searchParams.get('slug'))
  if (!gate.ok) return gate.response
  const { session } = gate

  const { taskId } = await params
  const body = await readJson(request)
  const text = typeof body === 'object' && body !== null && 'text' in body
    ? (body as { text?: unknown }).text
    : undefined

  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'Empty comment' }, { status: 400 })
  }

  const scope = await requireTaskInPortal(taskId, gate.portal)
  if (!scope.ok) return scope.response

  // All client comments are public by definition — prefix so they pass the filter on GET.
  // Agency team must manually add [PUBLIC] in ClickUp to expose their replies.
  const clientLabel = session.name ? `(${session.name})` : '(Klient)'
  const created = await addComment(taskId, `${PUBLIC_PREFIX}${clientLabel} ${text}`)

  // Podpis "(Imię)" w ClickUpie jest tekstem i imiona się powtarzają, więc
  // rozstrzygające przypisanie do konta trzymamy u siebie.
  // resourceId = id KOMENTARZA (nie zadania) — to on jest kluczem, po którym
  // trasa PUT/DELETE rozstrzyga, czy wolno go edytować/usunąć. taskId zostaje
  // w meta, gdyby był kiedyś potrzebny do wyświetlenia.
  await logEvent({
    portalId: session.portalId,
    actor: { userId: session.userId, email: session.email, name: session.name },
    action: EVENT_COMMENT_ADDED,
    resourceId: created.id,
    meta: { excerpt: text.trim().slice(0, 200), taskId },
  })

  // `created` jest okrojoną odpowiedzią ClickUpa (patrz buildOwnComment).
  // Klient dostaje pełny obiekt zbudowany z tego, co sami napisaliśmy.
  const comment = buildOwnComment(created, text, session.name)

  return NextResponse.json({ comment })
}
