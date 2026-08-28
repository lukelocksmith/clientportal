/**
 * Wywołuje PRAWDZIWE powiadomienie o zadaniu, przez prawdziwego producenta
 * i prawdziwy SMTP. Do sprawdzenia „czy mail w ogóle wychodzi".
 *
 *   node --env-file=.env.local --import tsx scripts/wyslij-probne-powiadomienie.ts <slug> <taskId> [comment|status|created|closed]
 *
 * ODMAWIA pracy, gdy DATABASE_URL nie wskazuje na localhost, ORAZ gdy SMTP_HOST
 * nie jest lokalny. Drugi warunek jest ważniejszy od pierwszego: bez niego
 * jedno uruchomienie ze skopiowanym środowiskiem produkcyjnym wysyła
 * prawdziwym ludziom maila o zadaniu, którego nikt nie tknął.
 *
 * Do łapania poczty lokalnie:
 *   mailpit --smtp 127.0.0.1:1025 --listen 127.0.0.1:8025 --smtp-auth-accept-any --smtp-auth-allow-insecure
 *   SMTP_HOST=127.0.0.1 SMTP_PORT=1025 SMTP_USER=test@local SMTP_PASS=test ...
 */

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error('DATABASE_URL nie wskazuje na localhost. Przerywam.')
    process.exit(1)
  }
  const smtp = process.env.SMTP_HOST ?? ''
  if (!/^(localhost|127\.0\.0\.1|::1)$/.test(smtp)) {
    console.error(`SMTP_HOST to "${smtp}", a nie serwer lokalny. Przerywam, żeby nie wysłać maila prawdziwym ludziom.`)
    process.exit(1)
  }

  const [slug, taskId, event = 'comment'] = process.argv.slice(2)
  if (!slug || !taskId) {
    console.error('Uzycie: <slug> <taskId> [comment|status|created|closed]')
    process.exit(1)
  }

  const { db } = await import('../src/lib/db')
  const { portals } = await import('../src/lib/db/schema')
  const { eq } = await import('drizzle-orm')
  const { produceNotifications } = await import('../src/lib/notifyProducer')

  const [portal] = await db.select().from(portals).where(eq(portals.slug, slug)).limit(1)
  if (!portal) {
    console.error(`Nie ma portalu "${slug}".`)
    process.exit(1)
  }

  const wynik = await produceNotifications({
    portalId: portal.id,
    taskId,
    taskName: 'Zadanie próbne (test lokalny)',
    event: event as 'comment',
    excerpt: 'To jest próbne powiadomienie z lokalnej maszyny.',
    author: 'Zespół important.is',
    // Bez tego druga próba na to samo zadanie zostanie uznana za powtórkę
    // i nie wyśle nic — brama powtórek działa na kluczu zdarzenia.
    clickupCommentId: `proba-${Date.now()}`,
  })

  console.log(`Dzwonek: ${wynik.bell}, maile wyslane: ${wynik.mailed}${wynik.reason ? `, powod: ${wynik.reason}` : ''}`)
  console.log('Skrzynka lokalna: http://127.0.0.1:8025')
  process.exit(0)
}

main()

// Modul, nie skrypt globalny (patrz komentarz w seed-local-portal.ts).
export {}
