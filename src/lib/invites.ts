import { randomBytes, createHash } from 'crypto'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from './db'
import { portalUsers, userInvites } from './db/schema'

/**
 * Zaproszenia do portalu: nowy użytkownik dostaje mailem jednorazowy link,
 * pod którym ustawia własne hasło. My nigdy nie znamy jego hasła.
 *
 * Token trzymamy tylko jako hash SHA-256, tak samo jak w tabeli sesji.
 * Surowy token istnieje wyłącznie w treści maila. Wyciek bazy nie daje więc
 * nikomu możliwości ustawienia hasła klientowi.
 */
const TOKEN_BYTES = 32

/** Pierwsze zaproszenie: klient moze nie zajrzec do skrzynki od razu. */
export const INVITE_TTL_HOURS = 72

/**
 * Odzyskiwanie hasla: krocej, bo tu uzytkownik wlasnie o to poprosil i siedzi
 * przy skrzynce. Kazda dodatkowa godzina wazności to okno, w ktorym link z
 * przechwyconego maila nadal dziala.
 */
export const RESET_TTL_HOURS = 2

/**
 * Ile czekamy miedzy kolejnymi prosbami o reset dla tego samego konta.
 * Bez tego formularz "nie pamietam hasla" jest darmowym narzedziem do zasypania
 * cudzej skrzynki, a nasz serwer SMTP trafia na czarne listy.
 */
export const RESET_COOLDOWN_MINUTES = 10

export type InviteKind = 'invite' | 'reset'

export function ttlHoursFor(kind: InviteKind): number {
  return kind === 'reset' ? RESET_TTL_HOURS : INVITE_TTL_HOURS
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Hasło niemożliwe do odgadnięcia i do użycia, wstawiane przy tworzeniu konta
 * przed ustawieniem własnego.
 *
 * Kolumna `password_hash` jest NOT NULL, a puste albo przewidywalne hasło
 * byłoby dziurą: konto istnieje od momentu utworzenia i formularz logowania
 * jest dla niego otwarty. bcrypt z losowych 32 bajtów daje hash, do którego
 * nie istnieje żadne hasło, jakie ktoś mógłby wpisać.
 */
export async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(TOKEN_BYTES).toString('hex'), 12)
}

export type CreatedInvite = {
  /** Surowy token. Wkładany do linku w mailu i NIGDZIE indziej. */
  token: string
  expiresAt: Date
  kind: InviteKind
}

/**
 * Tworzy zaproszenie dla użytkownika. Wcześniejsze, niewykorzystane
 * zaproszenia tego użytkownika tracą moc, żeby po ponownym wysłaniu działał
 * tylko najnowszy link.
 */
export async function createInvite(
  userId: string,
  portalId: string,
  kind: InviteKind = 'invite'
): Promise<CreatedInvite> {
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const expiresAt = new Date(Date.now() + ttlHoursFor(kind) * 60 * 60 * 1000)

  // Unieważnienie starych: oznaczamy jako użyte, zamiast kasować, żeby
  // została historia, kto i kiedy był zapraszany.
  await db
    .update(userInvites)
    .set({ usedAt: new Date() })
    .where(and(eq(userInvites.userId, userId), isNull(userInvites.usedAt)))

  await db.insert(userInvites).values({
    kind,
    userId,
    portalId,
    tokenHash: hashInviteToken(token),
    expiresAt,
  })

  return { token, expiresAt, kind }
}

/** Trzy rozroznialne powody odmowy. Kazdy ma inny komunikat dla uzytkownika. */
export type InviteFailure = 'not-found' | 'expired' | 'used'

export type InviteCheck =
  | {
      ok: true
      userId: string
      portalId: string
      email: string
      name: string | null
      portalSlug: string
      kind: InviteKind
    }
  | { ok: false; reason: InviteFailure }

/**
 * Sprawdza token bez zużywania go. Używane przez stronę ustawienia hasła,
 * żeby pokazać sensowny komunikat zanim ktokolwiek cokolwiek wpisze.
 *
 * Rozróżniamy 'expired' i 'used', bo to różne komunikaty dla użytkownika:
 * przy wygasłym trzeba poprosić o nowy link, przy zużytym wystarczy się
 * zalogować. 'not-found' zbiera resztę, w tym token wymyślony.
 */
export async function checkInvite(token: string): Promise<InviteCheck> {
  if (!token || token.length < 16) return { ok: false, reason: 'not-found' }

  const rows = await db
    .select({
      id: userInvites.id,
      userId: userInvites.userId,
      portalId: userInvites.portalId,
      expiresAt: userInvites.expiresAt,
      usedAt: userInvites.usedAt,
      kind: userInvites.kind,
      email: portalUsers.email,
      name: portalUsers.name,
    })
    .from(userInvites)
    .innerJoin(portalUsers, eq(userInvites.userId, portalUsers.id))
    .where(eq(userInvites.tokenHash, hashInviteToken(token)))
    .limit(1)

  const row = rows[0]
  if (!row) return { ok: false, reason: 'not-found' }
  if (row.usedAt) return { ok: false, reason: 'used' }
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' }

  // Slug portalu potrzebny do przekierowania po ustawieniu hasła.
  const { portals } = await import('./db/schema')
  const [portal] = await db
    .select({ slug: portals.slug })
    .from(portals)
    .where(eq(portals.id, row.portalId))
    .limit(1)

  if (!portal) return { ok: false, reason: 'not-found' }

  return {
    ok: true,
    userId: row.userId,
    portalId: row.portalId,
    email: row.email,
    name: row.name,
    portalSlug: portal.slug,
    kind: row.kind === 'reset' ? 'reset' : 'invite',
  }
}

/**
 * Ustawia hasło i zużywa zaproszenie. Jedna transakcja logiczna: oznaczenie
 * jako użyte i zapis hasła muszą pójść razem, inaczej ten sam link dałby się
 * użyć dwa razy.
 *
 * Warunek `isNull(usedAt)` w UPDATE jest zabezpieczeniem przed wyścigiem:
 * dwa równoczesne żądania z tym samym tokenem i tylko jedno zmieni wiersz.
 */
export async function consumeInvite(
  token: string,
  newPassword: string
): Promise<{ ok: true; portalSlug: string } | { ok: false; reason: InviteFailure }> {
  const check = await checkInvite(token)
  if (!check.ok) return { ok: false, reason: check.reason }

  const claimed = await db
    .update(userInvites)
    .set({ usedAt: new Date() })
    .where(and(eq(userInvites.tokenHash, hashInviteToken(token)), isNull(userInvites.usedAt)))
    .returning({ id: userInvites.id })

  if (claimed.length === 0) return { ok: false, reason: 'used' }

  const passwordHash = await bcrypt.hash(newPassword, 12)
  await db
    .update(portalUsers)
    .set({ passwordHash, isActive: true, failedAttempts: 0, lockedUntil: null })
    .where(eq(portalUsers.id, check.userId))

  return { ok: true, portalSlug: check.portalSlug }
}

/**
 * Czy dla tego konta poproszono o reset w ciągu ostatnich N minut.
 *
 * Ochrona przed zasypaniem cudzej skrzynki: formularz "nie pamiętam hasła"
 * jest publiczny i bez tego każdy mógłby wysyłać maile na dowolny adres
 * w pętli. Liczymy po `createdAt`, nie po `expiresAt`, bo interesuje nas
 * moment PROŚBY, nie ważność linku.
 */
export async function resetRequestedRecently(
  userId: string,
  minutes: number = RESET_COOLDOWN_MINUTES
): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60 * 1000)
  const rows = await db
    .select({ id: userInvites.id })
    .from(userInvites)
    .where(
      and(
        eq(userInvites.userId, userId),
        eq(userInvites.kind, 'reset'),
        gt(userInvites.createdAt, since)
      )
    )
    .limit(1)
  return rows.length > 0
}

/** Czy użytkownik ma ważne, niewykorzystane zaproszenie. Panel to pokazuje. */
export async function hasPendingInvite(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userInvites.id })
    .from(userInvites)
    .where(
      and(
        eq(userInvites.userId, userId),
        isNull(userInvites.usedAt),
        gt(userInvites.expiresAt, new Date())
      )
    )
    .orderBy(desc(userInvites.createdAt))
    .limit(1)
  return rows.length > 0
}
