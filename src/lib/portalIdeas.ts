import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from './db'
import { auditLog } from './db/schema'
import { createTask } from './clickup'
import { withReporterFooter } from './reporter'

/**
 * Pomysły klientów na ulepszenie portalu.
 *
 * Trafiają jako zadania do NASZEJ listy w folderze important.is, nie do folderu
 * klienta. To jest istotne: pomysł o portalu jest naszą pracą nad produktem,
 * a nie zleceniem dla klienta, więc nie ma prawa pojawić się na jego kanbanie
 * ani w jego Historii.
 *
 * Zapis idzie do `audit_log`, nie do nowej tabeli. Kolumny (`userId`,
 * `portalId`, `action`, `resourceId`, `meta`) pokrywają wszystko, co tu
 * potrzebne, więc migracja byłaby dodawaniem struktury bez powodu.
 */
export const IDEA_ACTION = 'portal_idea'

/** Odstęp między pomysłami jednego użytkownika. Ochrona przed zasypaniem listy. */
export const IDEA_COOLDOWN_MINUTES = 2

export const IDEA_MIN_LENGTH = 10
export const IDEA_MAX_LENGTH = 2000

export type IdeaResult =
  | { ok: true; taskCreated: boolean }
  | { ok: false; reason: 'too-short' | 'too-long' | 'cooldown' | 'not-configured' }

export async function ideaSubmittedRecently(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - IDEA_COOLDOWN_MINUTES * 60 * 1000)
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(eq(auditLog.userId, userId), eq(auditLog.action, IDEA_ACTION), gt(auditLog.createdAt, since))
    )
    .limit(1)
  return rows.length > 0
}

/**
 * Zapisuje pomysł i próbuje utworzyć z niego zadanie w ClickUpie.
 *
 * KOLEJNOŚĆ JEST CELOWA: najpierw zapis u nas, potem ClickUp. Gdyby było
 * odwrotnie, awaria ClickUpa oznaczałaby bezpowrotnie utracony pomysł klienta,
 * który usłyszałby „coś poszło nie tak" i najprawdopodobniej nie napisałby
 * drugi raz. Przy tej kolejności pomysł jest bezpieczny, a nieudane utworzenie
 * zadania jest naszym problemem do nadrobienia, nie jego.
 *
 * Dlatego `taskCreated: false` NIE jest błędem dla klienta: jego pomysł
 * dotarł. Wołający ma mu podziękować, a nie pokazywać awarię.
 */
export async function submitIdea(input: {
  userId: string | null
  portalId: string
  portalName: string
  portalSlug: string
  authorEmail: string
  authorName: string | null
  text: string
}): Promise<IdeaResult> {
  const text = input.text.trim()
  if (text.length < IDEA_MIN_LENGTH) return { ok: false, reason: 'too-short' }
  if (text.length > IDEA_MAX_LENGTH) return { ok: false, reason: 'too-long' }

  const listId = process.env.CLICKUP_PORTAL_IDEAS_LIST_ID
  if (!listId) {
    // Brak konfiguracji jest bledem NASZYM, nie klienta, ale bez listy nie ma
    // gdzie tego skierowac. Zapisujemy u siebie i zglaszamy do logu.
    await recordIdea({ ...input, text, taskId: null })
    console.error('[portalIdeas] brak CLICKUP_PORTAL_IDEAS_LIST_ID — pomysł zapisany tylko lokalnie')
    return { ok: false, reason: 'not-configured' }
  }

  const auditId = await recordIdea({ ...input, text, taskId: null })

  try {
    // Nazwa musi dawac sie przeskanowac na liscie, wiec projekt na poczatku,
    // a potem pierwsze zdanie pomyslu.
    const firstLine = text.split('\n')[0].slice(0, 80)
    const task = await createTask(listId, {
      name: `[portal ${input.portalSlug}] ${firstLine}`,
      // Ta sama stopka, co przy zadaniach klienta (lib/reporter.ts). Dwa
      // formaty „kto zgłosił" w jednym ClickUpie różniłyby się z czasem.
      description: withReporterFooter(text, {
        name: input.authorName,
        email: input.authorEmail,
        portalName: input.portalName,
        portalSlug: input.portalSlug,
        source: 'idea',
      }),
      status: 'backlog',
    })

    await db.update(auditLog).set({ resourceId: task.id }).where(eq(auditLog.id, auditId))
    return { ok: true, taskCreated: true }
  } catch (e) {
    console.error('[portalIdeas] nie udało się utworzyć zadania w ClickUpie:', e)
    // Pomysł jest u nas, wiec dla klienta to sukces.
    return { ok: true, taskCreated: false }
  }
}

async function recordIdea(input: {
  userId: string | null
  portalId: string
  text: string
  authorEmail: string
  authorName: string | null
  taskId: string | null
}): Promise<string> {
  const [row] = await db
    .insert(auditLog)
    .values({
      // userId jest nullem dla admina, ktory nie ma prawdziwego konta w portalu.
      userId: input.userId,
      // Autor idzie do KOLUMN, nie tylko do meta. Wcześniej adres siedział w
      // JSON-ie i wspólna historia zdarzeń (lib/portalEvents.ts) pokazywałaby
      // pomysł jako zgłoszenie bez autora.
      userEmail: input.authorEmail,
      userName: input.authorName,
      portalId: input.portalId,
      action: IDEA_ACTION,
      resourceId: input.taskId,
      meta: JSON.stringify({ email: input.authorEmail, text: input.text }),
    })
    .returning({ id: auditLog.id })
  return row.id
}

/** Ile pomysłów zgłoszono z tego portalu. Panel admina może to pokazać. */
export async function countIdeas(portalId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(eq(auditLog.portalId, portalId), eq(auditLog.action, IDEA_ACTION)))
  return rows[0]?.n ?? 0
}
