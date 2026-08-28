/**
 * Stawia LOKALNIE portal i konto, żeby dało się kliknąć portal w przeglądarce.
 *
 *   node --env-file=.env.local --import tsx scripts/seed-local-portal.ts <slug> <folderClickUp> <email> [haslo]
 *
 * Przykład (tablica ciągnie prawdziwe zadania WDF, tylko do odczytu):
 *   ... scripts/seed-local-portal.ts lokalny 90129337874 ja@local.test lokalnie123
 *
 * Skrypt ODMAWIA pracy, gdy DATABASE_URL nie wskazuje na localhost: konta
 * z hasłem „lokalnie123" nie mają prawa powstać na produkcji, nawet przez
 * pomyłkę w jednym eksporcie.
 *
 * Uwaga: portal wskazuje na PRAWDZIWY folder w ClickUpie, więc tablica pokaże
 * prawdziwe zadania klienta (odczyt). Dodanie komentarza z lokalnego portalu
 * DOPISZE go do prawdziwego zadania — nie rób tego przy klikaniu na próbę.
 */

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error('DATABASE_URL nie wskazuje na localhost. Przerywam.')
    process.exit(1)
  }

  const [slug, folderId, email, haslo = 'lokalnie123'] = process.argv.slice(2)
  if (!slug || !folderId || !email) {
    console.error('Uzycie: <slug> <folderClickUp> <email> [haslo]')
    process.exit(1)
  }

  const bcrypt = (await import('bcryptjs')).default
  const { db } = await import('../src/lib/db')
  const { portals, portalUsers } = await import('../src/lib/db/schema')
  const { eq, and } = await import('drizzle-orm')

  const [istniejacy] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  const portal = istniejacy ?? (await db
    .insert(portals)
    .values({
      slug,
      name: slug.toUpperCase(),
      clickupFolderId: folderId,
      clickupSpaceId: process.env.CLICKUP_SPACE_ID ?? '',
      // Mail o komentarzu WŁĄCZONY, inaczej obserwator i tak nic nie dostanie:
      // macierz admina jest bramą przed regułą odbiorców.
      notificationConfig: { comment: { bell: true, mail: true }, status: { bell: true, mail: true } },
    })
    .returning())[0]

  const [konto] = await db
    .select()
    .from(portalUsers)
    .where(and(eq(portalUsers.portalId, portal.id), eq(portalUsers.email, email)))
    .limit(1)

  const passwordHash = await bcrypt.hash(haslo, 10)
  if (konto) {
    await db.update(portalUsers).set({ passwordHash, isActive: true }).where(eq(portalUsers.id, konto.id))
  } else {
    await db.insert(portalUsers).values({
      portalId: portal.id,
      email,
      name: email.split('@')[0],
      passwordHash,
    })
  }

  // Drugie konto, zeby bylo kogo dopisac jako obserwatora.
  const drugi = `drugi-${slug}@local.test`
  const [istniejeDrugi] = await db
    .select()
    .from(portalUsers)
    .where(and(eq(portalUsers.portalId, portal.id), eq(portalUsers.email, drugi)))
    .limit(1)
  if (!istniejeDrugi) {
    await db.insert(portalUsers).values({
      portalId: portal.id,
      email: drugi,
      name: 'Druga Osoba',
      passwordHash: await bcrypt.hash(haslo, 10),
    })
  }

  console.log(`Portal:  http://localhost:3000/${slug}`)
  console.log(`Login:   ${email}`)
  console.log(`Haslo:   ${haslo}`)
  console.log(`Do dopisania jako obserwator: Druga Osoba <${drugi}>`)
  process.exit(0)
}

main()

// Plik jest MODULEM, nie skryptem globalnym: bez tego `main` z kilku
// skryptow w tym katalogu koliduje ze soba w jednym projekcie TS.
export {}
