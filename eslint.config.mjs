import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Katalog wtyczki remember, nie nasz kod.
    ".remember/**",
    // Skrypt migracji uruchamiany przez node w kontenerze PRZED zbudowaniem
    // aplikacji, wiec musi byc CommonJS i uzywac require(). Reguly dla kodu
    // aplikacji nie maja tu zastosowania.
    "migrate.js",
  ]),
]);

export default eslintConfig;
