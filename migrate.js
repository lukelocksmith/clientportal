const { drizzle } = require('drizzle-orm/postgres-js')
const { migrate } = require('drizzle-orm/postgres-js/migrator')
const postgres = require('postgres')

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL not set, skipping migration')
    return
  }
  const client = postgres(connectionString, { prepare: false, max: 1 })
  const db = drizzle(client)
  await migrate(db, { migrationsFolder: './migrations' })
  await client.end()
  console.log('Migrations complete')
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
