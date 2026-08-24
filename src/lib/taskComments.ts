import { sql } from 'drizzle-orm'
import { db } from './db'
import { taskComments } from './db/schema'
import type { ClickUpComment } from './types'
import { filterPublicComments, AGENCY_SENDER } from './publicComments'

/**
 * Rozmowa z klientem, zapisywana u nas. Krok 1 kierunku ustalonego w
 * docs/superpowers/specs/2026-08-09-portal-2.0-kierunek-design.md.
 *
 * Dwa źródła zapisu, oba idempotentne po `clickup_comment_id`:
 *
 * - `recordClientComment` — od razu, gdy klient pisze W PORTALU (po udanym
 *   lustrze do ClickUpa, patrz trasa POST /comments).
 * - `syncPublishedComments` — wciąga to, co już przeszło filtr widoczności
 *   z ClickUpa: odpowiedzi zespołu z `[P]`, ORAZ komentarz klienta odczytany
 *   z powrotem jako lustro. Ten drugi przypadek jest CELOWO nieszkodliwy:
 *   `clickup_comment_id` jest ten sam, konflikt aktualizuje wyłącznie `body`,
 *   więc nie nadpisuje `author_id` ani `source` ustawionych przy pierwszym
 *   zapisie z portalu.
 *
 * ODCZYT w portalu na razie nadal idzie z ClickUpa. Ta tabela się napełnia,
 * żeby przełączenie źródła było zmianą jednego zapytania.
 */

export type RecordClientCommentInput = {
  portalId: string
  clickupTaskId: string
  clickupCommentId: string
  /** 'client' dla właściwego klienta, 'agency' gdy odpowiada PM z obejściem admina (patrz session.userId === 'admin' w route.ts). */
  authorType: 'client' | 'agency'
  /** Null dla PM-a: sesja admina nie jest wierszem w portal_users, więc nie ma czego wstawić do klucza obcego. */
  authorId: string | null
  authorLabel: string
  body: string
  publishedAt?: Date
}

/** Komentarz napisany W PORTALU (klient albo PM przez obejście admina), tuż po udanym dodaniu go w ClickUpie. */
export async function recordClientComment(input: RecordClientCommentInput): Promise<void> {
  const body = input.body.trim()
  if (!body) return

  await db
    .insert(taskComments)
    .values({
      portalId: input.portalId,
      clickupTaskId: input.clickupTaskId,
      clickupCommentId: input.clickupCommentId,
      authorType: input.authorType,
      authorId: input.authorId,
      authorLabel: input.authorLabel,
      body,
      publishedAt: input.publishedAt ?? new Date(),
      source: 'portal',
    })
    // Wywołanie webhooka po własnym zapisie wraca tym samym `clickup_comment_id`
    // przez syncPublishedComments — ten wiersz już istnieje, nic tu nie robimy.
    .onConflictDoNothing({ target: taskComments.clickupCommentId })
}

export type SyncCommentsResult = {
  /** Ile komentarzy przeszło filtr widoczności i zostało zapisane (nowych albo już istniejących). */
  upserted: number
  /** Ile odrzucono: puste po zdjęciu znacznika i podpisu (np. sam `[P]`). */
  skipped: number
}

function toDate(raw: string | undefined): Date {
  const ms = Number(raw)
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date()
}

/**
 * Wciąga komentarze opublikowane do klienta z jednego zadania ClickUpa.
 *
 * Filtr widoczności jest DOKŁADNIE ten sam, co przy odczycie
 * (`filterPublicComments`) — jedno źródło prawdy, bez ryzyka rozjazdu opisanego
 * w nagłówku publicComments.ts. Wewnętrzna dyskusja bez `[P]` nigdy tu nie
 * dociera.
 */
export async function syncPublishedComments(
  portalId: string,
  clickupTaskId: string,
  rawComments: ClickUpComment[]
): Promise<SyncCommentsResult> {
  const publiczne = filterPublicComments(rawComments)
  let upserted = 0
  let skipped = 0

  for (const c of publiczne) {
    const body = (c.comment_text ?? '').trim()
    if (!body) {
      skipped++
      continue
    }

    const authorType = c.sender && c.sender !== AGENCY_SENDER ? 'client' : 'agency'

    await db
      .insert(taskComments)
      .values({
        portalId,
        clickupTaskId,
        clickupCommentId: c.id,
        authorType,
        authorLabel: c.sender ?? AGENCY_SENDER,
        body,
        publishedAt: toDate(c.date),
        source: 'clickup',
      })
      .onConflictDoUpdate({
        target: taskComments.clickupCommentId,
        // TYLKO body. `author_id`/`source` ustawione przy pierwszym zapisie
        // (np. przez recordClientComment) muszą przeżyć każdy kolejny sync —
        // patrz komentarz na górze pliku.
        set: { body: sql`excluded.body` },
      })

    upserted++
  }

  return { upserted, skipped }
}
