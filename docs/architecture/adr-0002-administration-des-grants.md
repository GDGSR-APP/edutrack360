# ADR 0002 - Administration de user_unit_grants : A4 sans chemin d'execution reel

**Statut** : Accepte (directeur de projet, Phase 4). Suit le modele de
l'ADR 0001.

## Contexte

A4 (plan v2) : "`user_unit_grants` saisi et administre a la main par le
directeur de projet (aucun groupe Workspace par ecole/fonction n'existe)."
Aucun mecanisme concret n'avait ete specifie pour cette administration -
seulement l'intention qu'elle se fasse "a la main", par opposition a une
automatisation via des groupes Workspace.

## Ce qui s'est revele impossible, par execution

En verifiant comment cette administration pourrait reellement se faire,
trouve empiriquement (`docs/phase4/notes-phase4.md`, section 1) :
`edutrack_schema_owner` - le seul role operationnel (hors application)
disposant par ailleurs de tous les privileges de proprietaire - ne peut
NI lire NI ecrire dans `users` ou `user_unit_grants` pour un autre
utilisateur que lui-meme :

```
INSERT INTO users (google_subject, email) VALUES (...);
-- ERROR:  new row violates row-level security policy for table "users"

INSERT INTO user_unit_grants (user_id, unit_id) VALUES (...);
-- ERROR:  new row violates row-level security policy for table "user_unit_grants"
```

Meme cause mecanique exacte que l'ADR 0001 : `FORCE ROW LEVEL SECURITY` +
`self_only` s'appliquent aussi au proprietaire de la table, qui n'a pas
`BYPASSRLS`. "Administre a la main" n'avait donc, tel quel, aucun chemin
d'execution reel en dehors d'un acces superutilisateur Postgres direct -
qui n'est pas necessairement disponible de la meme maniere en production.

## Decision

Trois options presentees au directeur de projet (`docs/phase4/notes-phase4.md`,
section 1) ; **Option A retenue** : fonctions `SECURITY DEFINER` etroites,
sur le meme modele que `find_or_create_user` (ADR 0001), plutot que
d'accorder `BYPASSRLS` directement a `edutrack_schema_owner` (rayon
d'effet bien plus large - contournerait RLS sur TOUTES les tables, pas
seulement celle-ci).

## Ce qui remplace la decision initiale

Nouveau role **`grants_admin_owner`** (`NOLOGIN`, `BYPASSRLS`, aucun mot
de passe, `infra/bootstrap-roles.sql`) - **distinct** de
`auth_bootstrap_owner` : ce dernier a deja un perimetre garanti exact par
un meta-test permanent (ADR 0001) ; l'elargir pour une tache sans rapport
aurait rompu cette garantie plutot que de la respecter.

Trois fonctions (migration `20261124000011_grants_administration.cjs`),
possedees par `grants_admin_owner`, `EXECUTE` accorde **uniquement a
`edutrack_schema_owner`** - jamais a `app_role`, pour que l'administration
reste structurellement hors de l'application :

- `grant_unit_access(p_user_id, p_unit_id)` - idempotent (`ON CONFLICT ...
  DO NOTHING`).
- `revoke_unit_access(p_user_id, p_unit_id)` - idempotent (`DELETE` sans
  erreur si la ligne n'existe pas).
- `list_user_unit_grants(p_user_id, p_unit_id)` - visibilite minimale,
  parametres optionnels ; necessaire car meme la LECTURE de l'etat actuel
  est bloquee pour `edutrack_schema_owner` par la meme policy `self_only`.

Perimetre exact, garanti par un meta-test permanent
(`tests/deny/meta-grants-admin-owner-perimeter.test.js`, detection depuis
le catalogue systeme) :

- Possede exactement ces 3 fonctions. Aucune table, vue, schema.
- Recoit exactement `SELECT, INSERT, DELETE` sur `user_unit_grants` -
  jamais sur `users`.
- Les 3 fonctions ne sont `EXECUTE`-ables que par `edutrack_schema_owner`
  (et implicitement par le proprietaire lui-meme) - jamais par `app_role`,
  jamais par `PUBLIC`.
- Aucun attribut de role dangereux au-dela de `BYPASSRLS` lui-meme.

Les trois corrections mecaniques de l'ADR 0001 (`search_path = ''` +
qualification explicite, `GRANT CREATE ON SCHEMA public` pour le nouveau
proprietaire, `GRANT` table explicite malgre `BYPASSRLS`) ont ete
appliquees preventivement - la migration est passee du premier coup,
confirmant que l'ADR 0001 a bien capitalise la lecon plutot que de la
laisser specifique a `find_or_create_user`.

## Consequences

- Le nombre de roles Postgres de ce projet est desormais 4 actes + 2
  ajoutes (Phase 3 : `auth_bootstrap_owner` ; Phase 4 :
  `grants_admin_owner`), tous deux pour la meme raison mecanique
  (`self_only` + `FORCE ROW LEVEL SECURITY` bloquant le proprietaire
  lui-meme), jamais pour une derive de perimetre volontaire.
- "Administre a la main" a maintenant un sens operationnel precis :
  un operateur connecte en tant que `edutrack_schema_owner` appelle
  `grant_unit_access`/`revoke_unit_access`/`list_user_unit_grants`. Ce
  n'est toujours pas une interface utilisateur - c'est delibere (A4,
  Phase 8 non atteinte).
- Pattern reutilisable etabli : toute future table avec `FORCE ROW LEVEL
  SECURITY` + `self_only` qui a besoin d'etre administree par un tiers
  rencontrera la meme impossibilite, et la meme solution (un role
  `BYPASSRLS` dedie et etroit, jamais un role existant elargi) s'applique.
