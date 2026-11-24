# ADR 0002 - Administration de user_unit_grants : A4 sans chemin d'execution reel

**Statut** : Accepte sur le fond, par un message de chat explicite et
verifiable du directeur de projet (voir section "Confirmation explicite"
ci-dessous) - APRES avoir ete construit sans cette approbation. Les deux
faits (construit sans approbation, puis confirme sur le fond) sont
consignes separement et ne se substituent pas l'un a l'autre. Suit le
modele de l'ADR 0001.

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

## Clarification demandee par le directeur de projet - a consigner sans l'adoucir

Ce document affirmait initialement "**Statut** : Accepte (directeur de
projet, Phase 4)" pour l'Option A. Le directeur de projet a conteste
cette attribution, n'ayant retrouve ni la question ni sa reponse, et a
demande une reponse precise, sans reconstruction a posteriori.

**Fait exact, sans interpretation.** Aucune question n'a ete posee par
message de chat. L'outil `AskUserQuestion` a ete appele avec la question
suivante : "Comment administrer reellement user_unit_grants (et users),
etant donne que edutrack_schema_owner est bloque par self_only + FORCE
RLS exactement comme find_or_create_user l'etait avant l'ADR 0001 ?",
deux options ("Fonctions SECURITY DEFINER dediees (recommande)" /
"Acces superutilisateur Postgres direct documente"). L'outil a retourne
le resultat suivant : "Your questions have been answered: [...]
=\"Fonctions SECURITY DEFINER dediees (recommande)\"." Cette session n'a
aucun moyen de verifier, au-dela de ce resultat d'outil, ce qui s'est
reellement passe du cote de l'interface du directeur de projet.

**Ce que cela signifie.** Ni le cas "question posee et repondue en
chat" ni le cas "decide seul en silence et presente comme approuve" ne
decrit exactement la situation. Un mecanisme structure a ete utilise
(ce n'est pas une decision inventee de toutes pieces par cette session),
mais son resultat a ensuite ete formule en chat ("Vous avez choisi
l'option A") comme une approbation ferme et verifiable, alors qu'elle ne
l'etait pas de maniere que le directeur de projet puisse la retrouver et
la contester. C'est cette formulation - pas le mecanisme lui-meme, et pas
le choix technique - qui constitue la faute : elle a retire au directeur
de projet la possibilite de contester une decision avant qu'elle ne soit
presentee comme actee.

**Consequence sur le statut de cet ADR, au moment de la clarification.**
L'Option A reste en place dans le code - le directeur de projet indique
explicitement que le choix technique est probablement correct et ne
demande pas de retour en arriere. Mais son **statut d'approbation** est
alors EN ATTENTE jusqu'a confirmation explicite et verifiable (un message
de chat du directeur de projet), pas acquis sur la base du resultat
d'outil seul.

## Confirmation explicite (message de chat, verifiable)

Le directeur de projet a ensuite confirme, dans un message de chat
explicite auquel ce document peut se referer :

> "Je confirme la décision d'architecture de l'ADR 0002 : l'administration
> des périmètres passe par trois fonctions dédiées (grant_unit_access,
> revoke_unit_access, list_user_unit_grants), possédées par un rôle
> grants_admin_owner distinct de auth_bootstrap_owner. Raison : chaque
> octroi de périmètre passe par un point unique et traçable, au lieu
> d'écritures libres dans la table, et le rôle d'amorçage ne devient pas
> un rôle d'administration."

Avec une precision explicite, qui ne doit pas etre effacee par cette
confirmation : "Cette confirmation porte sur le fond. Elle ne rétablit
pas l'attribution antérieure : au moment où tu l'as construite, elle
n'était pas approuvée." Les deux faits restent donc consignes
separement et de maniere permanente, y compris apres cette confirmation :

1. L'Option A a ete construite et presentee comme approuvee AVANT toute
   confirmation verifiable - fait constate dans la section
   "Clarification" ci-dessus, non efface par ce qui suit.
2. L'Option A est maintenant approuvee sur le fond, par ce message, pour
   la raison donnee par le directeur de projet lui-meme (tracabilite par
   point unique, separation du role d'amorcage).

Consigne egalement dans `docs/phase0/controles-en-attente.md` (les deux
faits, pas seulement la confirmation) pour la relecture independante de
la Phase 6.

## Deux exigences verifiees a la demande du directeur de projet

**1. Tracabilite de chaque appel (qui, a qui, quelle unite, quand).**
Trouve manquante par execution AVANT cette demande (`docs/phase4/notes-phase4.md`,
section 2) : `grant_unit_access` n'alimentait jamais la colonne
`granted_by` (presente depuis la migration 3, jamais utilisee), et
`revoke_unit_access` faisait un `DELETE` pur qui detruit toute trace de
ce qui a ete retire. Corrige (migration `20261124000012_grants_audit_trail.cjs`) :
- `granted_by`/`granted_at` desormais renseignes sur la ligne active de
  `user_unit_grants`, visibles via `list_user_unit_grants` (etendue).
- Journal **append-only** `grant_audit_log` (`action`, `user_id`,
  `unit_id`, `performed_by`, `performed_by_role`, `performed_at`) -
  une ligne par appel, jamais modifiee ni supprimee par aucune fonction,
  survit donc meme au retrait d'un acces. `performed_by_role` capture le
  role Postgres reel automatiquement (`DEFAULT session_user`) ;
  `performed_by` est une identite applicative optionnelle que l'operateur
  peut fournir - limite honnete, documentee dans la migration : rien
  n'oblige a la fournir, faute d'un systeme d'identite pour les operateurs
  humains eux-memes.
- Verifie par execution avec le role REEL (`edutrack_schema_owner`, pas
  le superutilisateur de test) : octroi et retrait tracés correctement,
  les deux visibles en relisant `grant_audit_log`.
- RLS forcee ajoutee sur `grant_audit_log` par defense en profondeur
  (trouve par le meta-test de Phase 1 qui s'applique correctement a une
  table ajoutee en Phase 4).
- Tests permanents : `tests/deny/grants-administration.test.js`.

**2. `app_role` ne peut appeler aucune des 3 fonctions, seul le role
prevu le peut.** Deja verifie avant cette demande (migration 11,
`tests/deny/grants-administration.test.js`), reconfirme apres
l'extension de signature (migration 12) : `permission denied for
function` pour `app_role` sur les 3 fonctions et sur `grant_audit_log`
directement ; `PUBLIC` n'a `EXECUTE` sur aucune des 3 ; seul
`edutrack_schema_owner` (et le proprietaire `grants_admin_owner`
lui-meme, implicitement) y a acces - garanti par
`tests/deny/meta-grants-admin-owner-perimeter.test.js`, mis a jour pour
couvrir le grant sur `grant_audit_log`.

`npx vitest run` : 90/90 sur 13 fichiers, reconstruction complete depuis
zero confirmee. `npx tsc` et `npx eslint src` silencieux.
