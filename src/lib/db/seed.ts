/**
 * Seed script — run with: npx tsx src/lib/db/seed.ts
 *
 * Creates a test portal and user for local development.
 * Edit the values below to match your ClickUp setup.
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import bcrypt from 'bcryptjs'

// ─── CONFIGURE THIS ────────────────────────────────────────────────────────
const PORTALS_TO_CREATE = [
  {
    slug: 'wdf',
    name: 'WDF',
    clickupFolderId: '90129337874',
    clickupSpaceId: '90100136256',
    lists: [
      { clickupListId: '901201180992', displayName: 'WDF', isDefault: true },
    ],
    users: [
      { email: 'klient@wdf.pl', password: 'ZmienMnie123!', name: 'Klient WDF' },
    ],
  },
  // Add more portals here as needed:
  // {
  //   slug: 'instytut-tus',
  //   name: 'Instytut TUS',
  //   clickupFolderId: '90129191811',
  //   clickupSpaceId: '90100136256',
  //   lists: [
  //     { clickupListId: '901215515686', displayName: 'Bricks', isDefault: true },
  //     { clickupListId: '901203269512', displayName: 'S.Psychologiczne', isDefault: false },
  //     { clickupListId: '901212496612', displayName: 'Błękitna Chatka', isDefault: false },
  //     { clickupListId: '901204994798', displayName: 'PomoceTUS', isDefault: false },
  //   ],
  //   users: [
  //     { email: 'tus@instytuttus.pl', password: 'ZmienMnie123!', name: 'Instytut TUS' },
  //   ],
  // },
]
// ─────────────────────────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL!
const client = postgres(connectionString, { prepare: false })
const db = drizzle(client, { schema })

async function main() {
  console.log('🌱 Seeding database...')

  for (const portalData of PORTALS_TO_CREATE) {
    // Upsert portal
    const [portal] = await db
      .insert(schema.portals)
      .values({
        slug: portalData.slug,
        name: portalData.name,
        clickupFolderId: portalData.clickupFolderId,
        clickupSpaceId: portalData.clickupSpaceId,
      })
      .onConflictDoUpdate({
        target: schema.portals.slug,
        set: { name: portalData.name, clickupFolderId: portalData.clickupFolderId },
      })
      .returning()

    console.log(`✅ Portal: ${portal.slug} (${portal.id})`)

    // Insert lists
    for (const listData of portalData.lists) {
      await db
        .insert(schema.portalLists)
        .values({
          portalId: portal.id,
          clickupListId: listData.clickupListId,
          displayName: listData.displayName,
          isDefault: listData.isDefault,
          sortOrder: portalData.lists.indexOf(listData),
        })
        .onConflictDoNothing()
      console.log(`  📋 List: ${listData.displayName}`)
    }

    // Insert users
    for (const userData of portalData.users) {
      const passwordHash = await bcrypt.hash(userData.password, 12)
      await db
        .insert(schema.portalUsers)
        .values({
          portalId: portal.id,
          email: userData.email.toLowerCase(),
          passwordHash,
          name: userData.name,
        })
        .onConflictDoNothing()
      console.log(`  👤 User: ${userData.email}`)
    }
  }

  console.log('\n✅ Seed complete!')
  console.log('\nTest credentials:')
  for (const p of PORTALS_TO_CREATE) {
    console.log(`  Portal: http://localhost:3000/${p.slug}`)
    for (const u of p.users) {
      console.log(`    Email: ${u.email}  |  Password: ${u.password}`)
    }
  }

  await client.end()
}

main().catch(console.error)
