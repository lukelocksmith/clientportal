/**
 * Kopiuje bundle widgetu SitePing do `public/`, żeby portal serwował go
 * stronom klientów pod stałym adresem `/siteping/widget.js`.
 *
 * Po co kopiowanie, a nie import: to plik statyczny dla CUDZYCH stron, nie
 * moduł naszej aplikacji. Next nie pakuje go do bundla, tylko oddaje jak
 * zwykły zasób.
 *
 * Po co stały adres bez wersji w nazwie: aktualizacja widgetu u wszystkich
 * klientów naraz ma iść jednym deployem portalu, bez proszenia kogokolwiek
 * o edycję kodu na jego stronie. Wersjonowany adres odwracałby tę decyzję
 * (patrz spec z 2026-08-10, sekcja o rezygnacji z SRI).
 *
 * Plik NIE jest commitowany (patrz .gitignore): to generowany artefakt
 * zależności, a nie nasz kod. Wchodzi do obrazu przez `prebuild`, bo
 * Dockerfile kopiuje całe `public/` na etapie budowania.
 *
 *   node scripts/copy-siteping-widget.mjs
 */
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const zrodlo = resolve(root, 'node_modules/@siteping/widget/dist/index.global.js')
const cel = resolve(root, 'public/siteping/widget.js')

try {
  await stat(zrodlo)
} catch {
  // Twardy błąd, nie ostrzeżenie: cicha kontynuacja znaczyłaby, że budujemy
  // obraz bez widgetu, a klienci zobaczyliby 404 na skrypcie dopiero po
  // wdrożeniu. Lepiej zatrzymać budowanie tutaj.
  console.error(
    `[siteping] brak bundla widgetu: ${zrodlo}\n` +
      'Zainstaluj zależności (npm ci). Pakiet @siteping/widget musi być w "dependencies", nie w "devDependencies".'
  )
  process.exit(1)
}

await mkdir(dirname(cel), { recursive: true })
await copyFile(zrodlo, cel)

const { size } = await stat(cel)
console.log(`[siteping] widget skopiowany do public/siteping/widget.js (${Math.round(size / 1024)} KB)`)
