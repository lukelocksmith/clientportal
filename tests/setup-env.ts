import * as dotenv from 'dotenv'
import path from 'node:path'

/**
 * Vitest nie wczytuje `.env.local` sam, w odroznieniu od Next, wiec bez tego
 * DATABASE_URL nie istnieje i testy integracyjne pomijaja sie z powodu
 * "baza nieosiagalna", choc baza chodzi.
 *
 * UWAGA, pulapka: NIE da sie tu uzyc `loadEnvConfig` z @next/env, mimo ze to
 * ta sama funkcja, ktorej uzywa aplikacja. @next/env CELOWO pomija `.env.local`,
 * gdy NODE_ENV to `test`, zeby testy nie zalezaly od lokalnej konfiguracji,
 * a Vitest ustawia wlasnie NODE_ENV=test. Wiec ten wybor nie mogl zadzialac.
 * Zwykly dotenv ze jawna sciezka jest jedyna droga i tak samo robia skrypty
 * w scripts/.
 *
 * Konsekwencja do zapamietania: testy integracyjne czytaja DATABASE_URL
 * z `.env.local`, czyli z LOKALNEJ bazy. Wskazanie tam produkcji oznaczaloby
 * uruchomienie testow, ktore tworza i kasuja portale, na zywych danych.
 */
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
