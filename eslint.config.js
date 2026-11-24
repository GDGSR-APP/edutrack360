const tseslint = require("typescript-eslint");

/*
 * A1 en code : "pg" (le pilote PostgreSQL) ne doit etre importe que dans
 * src/data-access/**. Ceci est un FREIN contre le cas courant, PAS une
 * impossibilite structurelle - trouvaille de la relecture de Phase 6
 * (docs/phase6/rapport-relecture-phase6.md). Durci pour couvrir require(),
 * import() dynamique, les sous-chemins (pg/lib/...) et les fichiers hors
 * .ts. La garantie STRUCTURELLE reelle reste independante de ce fichier :
 * app_role n'a aucun GRANT sur une table de base (A1) et FORCE ROW LEVEL
 * SECURITY s'applique quoi qu'il arrive.
 */
const RESTRICTED_PG_MESSAGE =
  "Acces DB direct interdit hors de src/data-access (A1). Passez par la couche d'acces.";

module.exports = tseslint.config(
  { ignores: ["eslint.config.js"] },
  tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.js", "**/*.mjs", "**/*.cjs"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "pg", message: RESTRICTED_PG_MESSAGE }],
          patterns: [{ group: ["pg/*"], message: RESTRICTED_PG_MESSAGE }],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value=/^pg([/].*)?$/]",
          message: RESTRICTED_PG_MESSAGE,
        },
        {
          selector: "ImportExpression[source.value=/^pg([/].*)?$/]",
          message: RESTRICTED_PG_MESSAGE + " (import() dynamique inclus.)",
        },
      ],
    },
  },
  {
    files: ["src/data-access/**/*.ts", "src/data-access/**/*.js"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  }
);
