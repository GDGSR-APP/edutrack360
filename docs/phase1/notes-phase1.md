# Notes Phase 1 - a l'attention de la relecture independante (Phase 6)

## Ecart de sequence TDD (point 3, consigne telle quelle, non corrigee)

Le plan demandait une suite de tests de refus **rouge avant l'implementation,
verte apres**. Ce qui s'est reellement passe : le schema (migrations) et les
tests (`tests/deny/*`) ont ete ecrits **en parallele**, pas tests-d'abord au
sens strict. Ce n'est pas corrige retroactivement dans l'historique git -
ce serait presenter une sequence qui n'a pas eu lieu.

Ce que la sequence reelle a quand meme produit, par execution, pas par
affirmation :

- Deux echecs reels rencontres et corriges en cours de route, pas simules :
  - Vitest 5 refusait `require()` (CommonJS) dans les fichiers de test -
    corrige en passant a `import` (ESM).
  - Le meta-test RLS avait une assertion fausse (liste de 4 tables au lieu
    de 5 - `user_unit_grants` porte aussi `unit_id` et a legitimement RLS
    forcee). Le schema etait correct ; c'est l'assertion du test qui etait
    fausse. Corrigee apres lecture du vrai resultat, pas devinee.
- Verification empirique de compatibilite PostgreSQL 16 (point 2) : memes
  migrations, memes tests, executes contre un second conteneur ephemere
  PG16, 7/7 passes - ajoutee apres la suite initiale, elle aussi hors de la
  sequence rouge-avant-vert-apres canonique.

## Ce que la relecture Phase 6 devrait donc verifier specifiquement

- Que les tests de refus testent reellement l'absence de grant et la
  correction des policies (lus, pas seulement executes avec succes) - un
  test ecrit apres coup peut etre biaise pour passer sans prouver la bonne
  propriete.
- Que `test_rls_probe` n'a aucune trace reelle dans la configuration de
  production (il ne doit exister que localement / dans un futur
  environnement de CI de test).
