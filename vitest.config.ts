import { defineConfig } from 'vitest/config'

/**
 * Dwa rodzaje testow, rozdzielone celowo:
 *
 * - JEDNOSTKOWE (src/**\/*.test.ts) — czysta logika, zero zaleznosci. Chodza
 *   w milisekundach, wiec da sie je trzymac w trybie watch przy pisaniu kodu.
 * - INTEGRACYJNE (tests/integration) — prawdziwy Postgres. Sprawdzaja SQL i
 *   granice bezpieczenstwa, czyli to, czego testy jednostkowe nie moga dotknac,
 *   bo tam blad siedzi w zapytaniu, nie w funkcji.
 *
 * Integracyjne SAME SIE POMIJAJA, gdy baza jest nieosiagalna, zeby `npm test`
 * dzialalo zawsze, takze na maszynie bez Dockera.
 *
 * Czego tu NIE MA i dlaczego: testow komponentow Reacta. Blad, ktory dzisiaj
 * polozyl aplikacje (sterownik postgres w paczce przegladarki), byl niewidoczny
 * dla `tsc` I byl by niewidoczny dla testu komponentu, bo funkcje dzialaly
 * poprawnie. Zlapal go bundler. Dlatego `next build` jest czescia `npm run
 * verify`, a nie opcja.
 */
export default defineConfig({
  // Natywne rozwiazywanie aliasu @/ z tsconfig. Wtyczka vite-tsconfig-paths
  // nie jest potrzebna, Vite umie to sam.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup-env.ts'],
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Integracyjne dotykaja tej samej bazy, wiec nie moga chodzic rownolegle:
    // jeden test czyscilby dane drugiemu.
    fileParallelism: false,
    globals: false,
  },
})
