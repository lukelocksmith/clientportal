import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Trzy rodzaje testow, rozdzielone celowo:
 *
 * - JEDNOSTKOWE (src/**\/*.test.ts) — czysta logika, zero zaleznosci. Chodza
 *   w milisekundach, wiec da sie je trzymac w trybie watch przy pisaniu kodu.
 * - INTEGRACYJNE (tests/integration) — prawdziwy Postgres. Sprawdzaja SQL i
 *   granice bezpieczenstwa, czyli to, czego testy jednostkowe nie moga dotknac,
 *   bo tam blad siedzi w zapytaniu, nie w funkcji.
 * - KOMPONENTOWE (**\/*.test.tsx) — render w jsdom. Odpowiadaja na pytanie
 *   „czy klient to zobaczy i czy da sie w to kliknac", ktorego nie zadaja
 *   pozostale dwa rodzaje.
 *
 * Integracyjne SAME SIE POMIJAJA, gdy baza jest nieosiagalna, zeby `npm test`
 * dzialalo zawsze, takze na maszynie bez Dockera.
 *
 * Srodowisko jest `node` DOMYSLNIE, bo jsdom kosztuje kilkaset milisekund na
 * plik, a wiekszosc testow przegladarki nie potrzebuje. Pliki komponentow
 * wlaczaja je same, blokiem `@vitest-environment jsdom` na gorze pliku.
 *
 * `next build` ZOSTAJE czescia `npm run verify` mimo tych testow. Blad, ktory
 * kiedys polozyl aplikacje (sterownik postgresa w paczce przegladarki), byl
 * niewidoczny dla `tsc` I bylby niewidoczny dla testu komponentu, bo wszystkie
 * funkcje dzialaly poprawnie. Zlapal go bundler i tylko bundler go zlapie.
 */
export default defineConfig({
  plugins: [react()],
  // Natywne rozwiazywanie aliasu @/ z tsconfig. Wtyczka vite-tsconfig-paths
  // nie jest potrzebna, Vite umie to sam.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup-env.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    // Integracyjne dotykaja tej samej bazy, wiec nie moga chodzic rownolegle:
    // jeden test czyscilby dane drugiemu.
    fileParallelism: false,
    globals: false,
  },
})
