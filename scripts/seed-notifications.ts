/**
 * Wrzuca przykładowe powiadomienia do LOKALNEJ bazy, do ręcznego oglądania.
 *
 *   node --env-file=.env.local --import tsx scripts/seed-notifications.ts onyx
 *
 * Skrypt ODMAWIA pracy, gdy DATABASE_URL nie wskazuje na localhost. To nie jest
 * narzędzie do produkcji i nie ma powodu, żeby dało się nim tam strzelić.
 *
 * Uwaga o `tsx`: projekt nie jest ESM, więc nie ma tu top-level await, a moduły
 * czytające env muszą być ładowane WEWNĄTRZ main(), po wczytaniu .env.local.
 */

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error('DATABASE_URL nie wskazuje na localhost. Przerywam.')
    process.exit(1)
  }

  const slug = process.argv[2]
  if (!slug) {
    console.error('Podaj slug portalu, np.: ... scripts/seed-notifications.ts onyx')
    process.exit(1)
  }

  const { db } = await import('../src/lib/db')
  const { portals, portalUsers, taskIndex } = await import('../src/lib/db/schema')
  const { createNotifications } = await import('../src/lib/notificationStore')
  const { eq } = await import('drizzle-orm')

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) {
    console.error(`Nie ma portalu o slugu "${slug}".`)
    process.exit(1)
  }

  const users = await db.select().from(portalUsers).where(eq(portalUsers.portalId, portal.id))
  if (users.length === 0) {
    console.error(`Portal "${slug}" nie ma użytkowników.`)
    process.exit(1)
  }

  /**
   * PRAWDZIWE zadania z indeksu tego portalu, nie wymyślone nazwy.
   *
   * Pierwsza wersja tego skryptu wstawiała `clickupTaskId: null`, więc klik
   * w powiadomienie prowadził na tablicę i zostawiał pytanie „to które to
   * zadanie". Powiadomienie bez zadania nie nadaje się nawet do sprawdzenia,
   * czy funkcja działa.
   */
  const zadania = await db
    .select({ id: taskIndex.clickupTaskId, name: taskIndex.name })
    .from(taskIndex)
    .where(eq(taskIndex.portalId, portal.id))
    .limit(4)

  if (zadania.length === 0) {
    console.error(
      `Portal "${slug}" nie ma nic w indeksie zadań, więc powiadomienia nie miałyby do czego prowadzić.\n` +
        'Uruchom najpierw synchronizację indeksu albo wybierz portal, który ma zadania.'
    )
    process.exit(1)
  }

  const wez = (i: number) => zadania[i % zadania.length]

  // Wszystkim użytkownikom portalu, żeby dało się sprawdzić dzwonek niezależnie
  // od tego, na które konto się zalogujesz.
  const rows = users.flatMap(u => [
    {
      portalId: portal.id,
      userId: u.id,
      kind: 'comment' as const,
      clickupTaskId: wez(0).id,
      taskName: wez(0).name,
      payload: {
        author: 'important.is',
        excerpt: 'Znaleźliśmy przyczynę, poprawka jedzie dziś na produkcję.',
      },
    },
    {
      portalId: portal.id,
      userId: u.id,
      kind: 'status' as const,
      clickupTaskId: wez(1).id,
      taskName: wez(1).name,
      payload: { from: 'do zrobienia', to: 'w trakcie' },
    },
    {
      portalId: portal.id,
      userId: u.id,
      kind: 'closed' as const,
      clickupTaskId: wez(2).id,
      taskName: wez(2).name,
      payload: { from: 'weryfikacja', to: 'zamknięte' },
    },
    {
      portalId: portal.id,
      userId: u.id,
      kind: 'panic_ack' as const,
      clickupTaskId: wez(3).id,
      taskName: wez(3).name,
      payload: {},
    },
  ])

  const created = await createNotifications(rows)
  console.log(`Wstawiono ${created.length} powiadomień dla ${users.length} osób w portalu "${slug}".`)
  for (const u of users) console.log(`  - ${u.email}`)
  process.exit(0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

// Modul, nie skrypt globalny: inaczej `main` koliduje z innymi skryptami
// w tym katalogu (TS widzi je w jednym projekcie).
export {}
