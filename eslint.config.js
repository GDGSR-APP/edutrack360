const tseslint = require("typescript-eslint");

/*
 * A1 en code : "pg" (le pilote PostgreSQL) ne peut etre importe que dans
 * src/data-access/**. C'est ce qui rend une requete DB directe depuis le
 * reste du code applicatif structurellement impossible, pas seulement
 * deconseillee - verifie par execution dans
 * docs/phase2/notes-phase2.md (une violation deliberee a ete testee et a
 * echoue le lint avant d'etre supprimee, jamais committee).
 */
module.exports = tseslint.config(
  { ignores: ["eslint.config.js"] },
  tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "pg",
              message:
                "Acces DB direct interdit hors de src/data-access (A1). Passez par la couche d'acces.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/data-access/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  }
);
