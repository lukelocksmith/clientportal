import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { portalUsers } from './db/schema'

/**
 * Zapytania profilu użytkownika. Podział jak przy powiadomieniach: czysta
 * logika siedzi w `profile.ts`, tutaj jest wyłącznie baza.
 *
 * KAŻDA funkcja bierze `portalId` i wiąże go warunkiem, mimo że identyfikator
 * konta pochodzi z sesji, a sesja jest już zawężona do jednego portalu.
 * To jest celowa nadmiarowość: gdyby kiedykolwiek trafił tu identyfikator
 * z żądania (a właśnie tego pilnują testy trasy), sam warunek portalu nie
 * pozwoli dosięgnąć konta innego klienta. Jedna linijka zabezpieczenia
 * w cudzym pliku to za mało, gdy stawką jest cudze konto.
 *
 * Zdjęcie ODDAJEMY osobną funkcją, nie w `getProfile`. Kolumna `avatar_url`
 * trzyma data URI i ma przy sobie zakaz wstawiania go w payloady list; gdyby
 * profil zwracał je razem z resztą, pierwszy wołający, który dołoży tę funkcję
 * do listy komentarzy, złamie ten zakaz nie wiedząc o nim.
 */

export type Profile = {
  id: string
  email: string
  name: string | null
  /** Sam fakt posiadania zdjęcia. Treść idzie trasą `/api/avatar`. */
  hasAvatar: boolean
}

export async function getProfile(userId: string, portalId: string): Promise<Profile | null> {
  const [row] = await db
    .select({
      id: portalUsers.id,
      email: portalUsers.email,
      name: portalUsers.name,
      avatarUrl: portalUsers.avatarUrl,
    })
    .from(portalUsers)
    .where(and(eq(portalUsers.id, userId), eq(portalUsers.portalId, portalId)))
    .limit(1)

  if (!row) return null
  return { id: row.id, email: row.email, name: row.name, hasAvatar: !!row.avatarUrl }
}

/**
 * Zapis imienia i zdjęcia. `undefined` znaczy „nie ruszaj", `null` znaczy
 * „wyczyść". Bez tego rozróżnienia zapis samego imienia kasowałby zdjęcie.
 */
export async function saveProfileFields(
  userId: string,
  portalId: string,
  fields: { name?: string | null; avatarUrl?: string | null }
): Promise<void> {
  const zmiany: { name?: string | null; avatarUrl?: string | null } = {}
  if (fields.name !== undefined) zmiany.name = fields.name
  if (fields.avatarUrl !== undefined) zmiany.avatarUrl = fields.avatarUrl
  // Pusty `set` kończy się błędem składni SQL, a nie pustym zapisem.
  if (Object.keys(zmiany).length === 0) return

  await db
    .update(portalUsers)
    .set(zmiany)
    .where(and(eq(portalUsers.id, userId), eq(portalUsers.portalId, portalId)))
}

/** Data URI zdjęcia albo null. Wyłącznie dla trasy `/api/avatar`. */
export async function getAvatarDataUri(userId: string, portalId: string): Promise<string | null> {
  const [row] = await db
    .select({ avatarUrl: portalUsers.avatarUrl })
    .from(portalUsers)
    .where(and(eq(portalUsers.id, userId), eq(portalUsers.portalId, portalId)))
    .limit(1)
  return row?.avatarUrl ?? null
}

/**
 * Wiersz potrzebny do sprawdzenia hasła: hash plus stan blokady.
 *
 * Kształt jest podyktowany przez `verifyUserPassword` (lib/loginAttempts.ts),
 * bo zmiana hasła używa DOKŁADNIE tego samego licznika prób co logowanie.
 * Formularz profilu jest drugim miejscem, w którym da się zgadywać hasło,
 * a osobny licznik znaczyłby, że napastnik wybiera to bez limitu.
 */
export async function getCredentials(userId: string, portalId: string): Promise<{
  id: string
  email: string
  name: string | null
  passwordHash: string
  failedAttempts: number | null
  lockedUntil: Date | null
} | null> {
  const [row] = await db
    .select({
      id: portalUsers.id,
      email: portalUsers.email,
      name: portalUsers.name,
      passwordHash: portalUsers.passwordHash,
      failedAttempts: portalUsers.failedAttempts,
      lockedUntil: portalUsers.lockedUntil,
    })
    .from(portalUsers)
    .where(and(eq(portalUsers.id, userId), eq(portalUsers.portalId, portalId)))
    .limit(1)
  return row ?? null
}

export async function savePasswordHash(
  userId: string,
  portalId: string,
  passwordHash: string
): Promise<void> {
  await db
    .update(portalUsers)
    // Licznik prób zerujemy razem z hasłem. `verifyUserPassword` robi to samo
    // po udanym sprawdzeniu, ale zapis idzie tu w jednym poleceniu, więc konto
    // nie zostaje z resztką blokady po zmianie hasła.
    .set({ passwordHash, failedAttempts: 0, lockedUntil: null })
    .where(and(eq(portalUsers.id, userId), eq(portalUsers.portalId, portalId)))
}
