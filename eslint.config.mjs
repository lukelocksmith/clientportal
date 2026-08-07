import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next, ale z `**/` z przodu.
    //
    // Samo `.next/**` dopasowuje WYLACZNIE katalog w korzeniu repo. Wystarczy
    // jeden worktree z wlasnym buildem (`.claude/worktrees/*/.next/`), zeby
    // `npm run verify` zwrocil pare tysiecy bledow w wygenerowanym kodzie
    // i przestal cokolwiek mowic o naszym. Brama przed pushem, ktora zawsze
    // jest czerwona, jest brama, ktora sie omija.
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/node_modules/**",
    "next-env.d.ts",
    // Katalog wtyczki remember, nie nasz kod.
    ".remember/**",
    // Skrypt migracji uruchamiany przez node w kontenerze PRZED zbudowaniem
    // aplikacji, wiec musi byc CommonJS i uzywac require(). Reguly dla kodu
    // aplikacji nie maja tu zastosowania.
    "**/migrate.js",
    // Worktree'y trzymaja WLASNA kopie calego repo. Ich pliki sa juz sprawdzane
    // tam, gdzie naprawde mieszkaja, czyli w tym samym repo na innej galezi.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
