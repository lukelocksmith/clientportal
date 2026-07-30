/**
 * Dosypuje konto admina do wszystkich istniejących projektów.
 * Nowe projekty dostają je same, przy POST /api/admin/portals.
 *
 *   npx tsx scripts/backfill-admin-users.ts          # tylko pokaz, bez zapisu
 *   npx tsx scripts/backfill-admin-users.ts --zapisz # faktyczny zapis
 *
 * Wypisuje host bazy przed zapisem, bo ten skrypt czyta DATABASE_URL z
 * .env.local i pomyłka między lokalną a produkcyjną bazą byłaby kosztowna.
 */
import * as dotenv from 'dotenv'
import path from 'node:path'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

async function main() {
  // Importy dynamiczne PO dotenv: db/index.ts i adminUser.ts czytają env
  // w ciele modułu, a statyczne importy są hoistowane nad dotenv.config().
  const { db } = await import('../src/lib/db')
  const { portals, portalUsers } = await import('../src/lib/db/schema')
  const { ensureAdminUser } = await import('../src/lib/adminUser')
  const { and, eq } = await import('drizzle-orm')

  const url = process.env.DATABASE_URL ?? ''
  const target = url.replace(/^[a-z]+:\/\/[^@]*@/, '') || '(brak DATABASE_URL)'
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@important.is').toLowerCase()
  const write = process.argv.includes('--zapisz')

  console.log(`baza:  ${target}`)
  console.log(`admin: ${adminEmail}`)
  console.log(`tryb:  ${write ? 'ZAPIS' : 'podglad (dodaj --zapisz, zeby zapisac)'}`)

  if (!process.env.ADMIN_PASSWORD_HASH) {
    console.error('\nBRAK ADMIN_PASSWORD_HASH — bez hasha nie tworzymy konta admina.')
    process.exit(1)
  }

  const all = await db.select({ id: portals.id, slug: portals.slug }).from(portals).orderBy(portals.slug)
  let missing = 0
  let added = 0

  for (const portal of all) {
    const has = await db
      .select({ id: portalUsers.id })
      .from(portalUsers)
      .where(and(eq(portalUsers.portalId, portal.id), eq(portalUsers.email, adminEmail)))
      .limit(1)

    if (has[0]) {
      console.log(`  ${portal.slug}: jest`)
      continue
    }

    missing++
    if (!write) {
      console.log(`  ${portal.slug}: BRAK (do dodania)`)
      continue
    }

    const id = await ensureAdminUser(portal.id)
    if (id) {
      added++
      console.log(`  ${portal.slug}: dodano`)
    } else {
      console.log(`  ${portal.slug}: NIE UDALO SIE`)
    }
  }

  console.log(
    `\nprojektow: ${all.length} | bez konta admina: ${missing} | dodanych: ${added}`
  )
  process.exit(0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
