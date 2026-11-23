# Plan v2 (approuve) - EduTrack360 : socle + module Notes (lecture seule)

Ce fichier est la version durable du plan approuve par le directeur de
projet, incluant les cinq precisions integrees avant le demarrage de la
Phase 0. Reference faisant foi pour les phases suivantes ; le detail complet
(tableaux de risques, dependances verifiees, sources) est dans l'historique
de conversation de planification et repris ici dans ses points structurants.

## Decisions actees

- **A1** - Aucun GRANT table pour `app_role`. Couche d'acces ecrite a la main,
  fonctions/vues `security_invoker`. RLS forcee = seconde barriere.
- **A2** - Authentification OIDC contre Google Workspace, pas d'IdP
  auto-heberge. Verification serveur : emetteur, audience, expiration,
  signature, **puis revendication `hd`** comparee au domaine attendu (jamais
  le suffixe de l'adresse - voir `docs/architecture/authentification-google.md`).
  Aucun jeton stocke. Session via `iron-session` (cookie httpOnly, sameSite
  strict, secure). Invariant : domaine valide != perimetre. Zero grant dans
  `user_unit_grants` = zero donnee visible, quel que soit le compte Google.
- **A4** - `user_unit_grants` saisi et administre a la main par le directeur
  de projet (aucun groupe Workspace par ecole/fonction n'existe).
- **A5** - Minimisation stricte (voir tableau des colonnes dans les echanges
  de planification). Pseudonymisation : `student_code` aleatoire, **non
  calculable** depuis l'identifiant national (pas de hash). Table de
  correspondance hors base applicative, jamais accessible a `app_role`,
  stockee sur le reseau ETL uniquement (voir `docs/architecture/topologie-reseau.md`).
  Colonnes calculees (`rank`, `cohort_size`, `support_capacity_signal`)
  **jamais repliquees** depuis la source - calculees en base applicative.
- **A6** - Mention obligatoire sur tout classement : "capacite
  d'accompagnement, pas un diagnostic".
- Seuils de `support_capacity_signal` : non definis, non inventes, table de
  configuration a valider par le metier (voir
  `docs/architecture/signal-accompagnement-et-fraicheur.md`).
- Fraicheur : date du dernier chargement ETL reussi visible sur toute page
  de donnees ETL.

## Roles Postgres (4)

`edutrack_schema_owner` (possede tout, migrations DDL, jamais utilise par
l'app en execution) / `app_role` (EXECUTE seul, aucun GRANT table, RLS
forcee) / `etl_loader_role` (EXECUTE seul sur fonctions de chargement
dediees) / `etl_source_reader_role` (SELECT seul sur la source, colonnes
limitees A5, cree seulement apres autorisation ecrite).

## Hebergement

VPS existant, Coolify, 22 Go RAM / 91 Go disque disponibles. Base applicative
en conteneur Postgres dedie, reseau Docker propre (`reseau-portail`), jamais
relie au reseau de la pile Supabase source. ETL en job ponctuel (pas un
service permanent), reseau Docker distinct (`reseau-etl`), seul composant a
toucher les trois mondes (source, base applicative, correspondance) - detail
dans `docs/architecture/topologie-reseau.md`.

## Phases (0 a 10)

0. Garde-fous, autorisations, signalement, topologie reseau - **en cours**.
1. Schema, 4 roles Postgres, RLS forcee, harnais de tests de refus.
2. Couche d'acces aux donnees (A1) + essai TypeScript 7.0.2 (repli 5.x si
   echec, decision non prise d'avance).
3. Authentification Google Workspace OIDC (A2).
4. Identites et perimetres (A4).
5. Sauvegarde, restauration, retour arriere (nouvelle phase v2).
6. Relecture de securite independante n°1 (couvre phases 1 a 5).
7. ETL lecture seule depuis la source (porte Phase 0 obligatoire).
8. API notes (lecture seule) + UI, mention A6, date de fraicheur (point 4).
9. Relecture de securite independante n°2 (authentification Google en
   situation reelle, sessions, CSRF, en-tetes, fuites HTML/journaux) - avant
   toute donnee reelle.
10. Cloture conformite.

## Arbitrages dependances actes

- `node-pg-migrate@9.0.0` : 3 avis modérés transitifs (`glob`/`minimatch`)
  **acceptes sans retrogradation** - outil execute localement, jamais expose
  en production.
- `typescript@7.0.2` : a essayer en Phase 2, repli 5.x si la chaine d'outils
  ne suit pas - mesure, pas tranche d'avance.
- `openid-client@6.9.1`, `jose@6.2.18`, `iron-session@9.1.1` : 0 avis mesure
  au 23/11/2026 (`npm audit`). `iron-session` exige Node >= 22.13.0 - plancher
  retenu pour tout le projet (plus strict que le `>=20.9.0` de Next.js).
