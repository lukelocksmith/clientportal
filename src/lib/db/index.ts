import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

/**
 * UTC WYMUSZONE NA POŁĄCZENIU, nie założone (31.08).
 *
 * Kolumny czasu są typu `timestamp` BEZ strefy, więc ich znaczenie zależy od
 * strefy sesji. Cała aplikacja liczy na UTC (wygasanie zaproszeń i sesji, wiek
 * przebiegów cronów, okna ponawiania w kolejce), a produkcyjna baza faktycznie
 * stoi w UTC — ale to była zbieżność, nie gwarancja. Na maszynie ze strefą
 * Europe/Warsaw te same zapytania dawały wynik przesunięty o dwie godziny,
 * czyli wygasły token bywał przyjmowany, a milczący cron wyglądał na zdrowy.
 *
 * `prepare: false` zostaje: prefetch nie działa w transakcjach.
 */
const client = postgres(connectionString, { prepare: false, connection: { timezone: 'UTC' } })
export const db = drizzle(client, { schema })
