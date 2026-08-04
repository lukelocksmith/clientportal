import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { portalUsers } from './db/schema'

/**
 * Sprawdzenie hasła razem z blokadą po nieudanych próbach.
 *
 * Wyciągnięte ze trasy logowania, bo od teraz są DWA wejścia: branding klienta
 * pod `/{slug}/login` oraz wspólny formularz na stronie głównej. Dwie kopie
 * tej logiki znaczyłyby, że jedno z wejść wcześniej czy później zostaje bez
 * blokady, a napastnik wybiera to słabsze. Liczby też muszą być wspólne:
 * pięć prób w jednym miejscu i brak limitu w drugim to brak limitu.
 */
export const MAX_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 15

export type LoginCheck = 'ok' | 'bad' | 'locked'

/**
 * Weryfikuje hasło i prowadzi licznik nieudanych prób.
 *
 * Zwraca 'locked' PRZED sprawdzeniem hasła: konto zablokowane nie ma prawa
 * powiedzieć, czy hasło było dobre, bo to zamieniłoby blokadę w wygodne
 * narzędzie do zgadywania.
 */
export async function verifyUserPassword(
  user: { id: string; passwordHash: string; failedAttempts: number | null; lockedUntil: Date | null },
  password: string
): Promise<LoginCheck> {
  if (user.lockedUntil && user.lockedUntil > new Date()) return 'locked'

  const valid = await bcrypt.compare(password, user.passwordHash)

  if (!valid) {
    const attempts = (user.failedAttempts ?? 0) + 1
    await db
      .update(portalUsers)
      .set({
        failedAttempts: attempts,
        lockedUntil: attempts >= MAX_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
          : null,
      })
      .where(eq(portalUsers.id, user.id))
    return 'bad'
  }

  // Udane logowanie zeruje licznik. Bez tego cztery pomyłki rozłożone na
  // tygodnie zablokowałyby konto przy piątej, mimo poprawnych logowań między nimi.
  await db
    .update(portalUsers)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(portalUsers.id, user.id))

  return 'ok'
}
