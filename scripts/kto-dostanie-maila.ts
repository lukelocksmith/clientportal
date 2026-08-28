/**
 * Kto dostanie maila o tym zadaniu. NIC NIE WYSYŁA.
 *
 *   node --env-file=.env.local --import tsx scripts/kto-dostanie-maila.ts <slug> <taskId> [comment|status|created|closed]
 *
 * Po co: sprawdzenie obserwatorów bez wysyłania czegokolwiek do ludzi.
 * Pyta DOKŁADNIE te same funkcje, których używa producent powiadomień
 * (`watcherUserIds` + `chooseRecipients` + macierz projektu), więc odpowiedź
 * nie jest rekonstrukcją reguły, tylko jej wynikiem.
 *
 * ODMAWIA pracy poza localhostem: to narzędzie do klikania po lokalnej bazie.
 */

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error('DATABASE_URL nie wskazuje na localhost. Przerywam.')
    process.exit(1)
  }

  const [slug, taskId, event = 'comment'] = process.argv.slice(2)
  if (!slug || !taskId) {
    console.error('Uzycie: <slug> <taskId> [comment|status|created|closed]')
    process.exit(1)
  }

  const { db } = await import('../src/lib/db')
  const { portals, portalUsers } = await import('../src/lib/db/schema')
  const { eq } = await import('drizzle-orm')
  const { watcherUserIds } = await import('../src/lib/taskWatchers')
  const { chooseRecipients } = await import('../src/lib/notifications')
  const { parseNotificationConfig, channelEnabled } = await import('../src/lib/notifyConfig')
  const { reporterUserId } = await import('../src/lib/portalEvents')

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) {
    console.error(`Nie ma portalu "${slug}".`)
    process.exit(1)
  }

  const users = await db
    .select({
      id: portalUsers.id,
      email: portalUsers.email,
      isActive: portalUsers.isActive,
      notifyImportant: portalUsers.notifyImportant,
      notifyBoard: portalUsers.notifyBoard,
    })
    .from(portalUsers)
    .where(eq(portalUsers.portalId, portal.id))

  const [obserwatorzy, zglaszajacy] = await Promise.all([
    watcherUserIds(portal.id, taskId),
    reporterUserId(portal.id, taskId),
  ])

  const config = parseNotificationConfig(portal.notificationConfig)
  const mailOn = channelEnabled(config, event as 'comment', 'mail')

  const odbiorcy = chooseRecipients({
    users,
    kind: event as 'comment',
    actorUserId: null,
    ownerUserId: zglaszajacy,
    watcherUserIds: obserwatorzy,
  })

  const email = new Map(users.map(u => [u.id, u.email]))
  console.log(`Projekt:      ${portal.name} (${slug})`)
  console.log(`Zadanie:      ${taskId}`)
  console.log(`Zdarzenie:    ${event}`)
  console.log(`Kanal mail:   ${mailOn ? 'wlaczony w macierzy' : 'WYLACZONY w macierzy — nie pojdzie do nikogo'}`)
  console.log(`Zglaszajacy:  ${zglaszajacy ? email.get(zglaszajacy) : 'brak (zadanie zespolu → mail do wszystkich)'}`)
  console.log(`Obserwatorzy: ${obserwatorzy.length ? obserwatorzy.map(id => email.get(id)).join(', ') : 'brak'}`)
  console.log('')
  for (const r of odbiorcy) {
    const czyObserwator = obserwatorzy.includes(r.userId) ? ' [obserwator]' : ''
    const poczta = mailOn && r.mail ? `MAIL (${r.mail})` : 'tylko dzwonek'
    console.log(`  ${email.get(r.userId)}${czyObserwator}: ${poczta}`)
  }
  process.exit(0)
}

main()

// Plik jest MODULEM, nie skryptem globalnym: bez tego `main` z kilku
// skryptow w tym katalogu koliduje ze soba w jednym projekcie TS.
export {}
