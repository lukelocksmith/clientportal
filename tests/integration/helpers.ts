import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portals, portalUsers, portalLists, taskIndex } from '@/lib/db/schema'

/**
 * Pomocniki testow integracyjnych.
 *
 * KAZDY test pracuje na WLASNYM, tymczasowym portalu o losowym slugu i usuwa go
 * po sobie. Powod jest prosty: w tej bazie siedza prawdziwe dane Onyxu i WDF,
 * a test, ktory je czysci albo modyfikuje, jest gorszy niz brak testu.
 * Kasowanie portalu kasuje kaskadowo wszystko, co do niego nalezy.
 */
export async function isDbReachable(): Promise<boolean> {
  try {
    await db.select({ id: portals.id }).from(portals).limit(1)
    return true
  } catch {
    return false
  }
}

export async function createTestPortal(prefix = 'test'): Promise<{ id: string; slug: string }> {
  const slug = `${prefix}-${Math.random().toString(36).slice(2, 10)}`
  const [portal] = await db
    .insert(portals)
    .values({
      slug,
      name: `Test ${slug}`,
      clickupFolderId: `fake-${slug}`,
      clickupSpaceId: 'fake-space',
    })
    .returning({ id: portals.id, slug: portals.slug })
  return portal
}

export async function dropTestPortal(portalId: string): Promise<void> {
  await db.delete(portals).where(eq(portals.id, portalId))
}

/**
 * Dopisuje liste do portalu, czyli ZAWEZA jego zakres.
 *
 * Portal bez list dziala na calym folderze (zgodnosc w tyl, patrz portalScope.ts),
 * wiec testy granicy list MUSZA jawnie utworzyc liste — inaczej sprawdzalyby
 * przypadek "brak zawezenia" w przekonaniu, ze sprawdzaja zawezenie.
 */
export async function createTestList(input: {
  portalId: string
  clickupListId: string
  isDefault?: boolean
}): Promise<void> {
  await db.insert(portalLists).values({
    portalId: input.portalId,
    clickupListId: input.clickupListId,
    displayName: `Lista ${input.clickupListId}`,
    isDefault: input.isDefault ?? false,
  })
}

export async function createTestUser(portalId: string, email: string): Promise<string> {
  const [user] = await db
    .insert(portalUsers)
    .values({ portalId, email, name: 'Test', passwordHash: 'x'.repeat(60) })
    .returning({ id: portalUsers.id })
  return user.id
}

/**
 * Konto z PRAWDZIWYM hashem bcrypt, do testow logowania.
 *
 * `createTestUser` wstawia atrape hasha, ktora `bcrypt.compare` odrzuci — do
 * testow sesji to wystarcza, bo one nie przechodza przez formularz. Test
 * logowania na takim koncie sprawdzalby wylacznie to, ze zle haslo nie wpuszcza,
 * i przechodzilby takze wtedy, gdyby DOBRE haslo tez nie wpuszczalo.
 *
 * `cost: 4` zamiast domyslnych 10: to jest najnizszy koszt akceptowany przez
 * bcryptjs, a testy logowania hashuja i porownuja dziesiatki razy. Sila hasha
 * nie jest tu przedmiotem testu.
 */
export async function createTestUserWithPassword(input: {
  portalId: string
  email: string
  password: string
  name?: string
}): Promise<string> {
  const [user] = await db
    .insert(portalUsers)
    .values({
      portalId: input.portalId,
      email: input.email,
      name: input.name ?? 'Test',
      passwordHash: bcrypt.hashSync(input.password, 4),
    })
    .returning({ id: portalUsers.id })
  return user.id
}

/** Wstawia wiersz do indeksu zadan. `searchText` podajemy juz zlozony. */
export async function insertIndexedTask(input: {
  portalId: string
  clickupTaskId: string
  name: string
  searchText: string
  status?: string
  statusType?: string
  priority?: string | null
  parentId?: string | null
  dateCreated: number
  dateClosed?: number | null
}): Promise<void> {
  await db.insert(taskIndex).values({
    portalId: input.portalId,
    clickupTaskId: input.clickupTaskId,
    name: input.name,
    searchText: input.searchText,
    status: input.status ?? 'zrobione',
    statusType: input.statusType ?? 'done',
    priority: input.priority ?? null,
    parentId: input.parentId ?? null,
    dateCreated: input.dateCreated,
    dateUpdated: input.dateCreated,
    dateClosed: input.dateClosed ?? null,
  })
}
