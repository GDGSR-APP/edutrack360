# Notes Phase 3 - trouvailles empiriques

## 0. Decision du directeur de projet : resolution d'identite au premier login

Question posee avant d'ecrire la moindre ligne de code d'authentification :
`users` est verrouillee par `self_only` sous `FORCE ROW LEVEL SECURITY`
(filtre sur `id = app_current_user_id()`), et `app_role` n'a aucun GRANT
table direct (A1). Au tout premier login d'un compte Google jamais vu, son
`id` applicatif n'existe pas encore - rien ne peut etre "soi-meme" avant
d'exister. Comment resoudre/creer cette ligne sans contredire ni A1 ni
self_only ?

Deux options proposees, le directeur de projet a retenu **l'option A** :
une fonction `SECURITY DEFINER` etroite (`find_or_create_user`), plutot
qu'un 5e role de connexion separe avec acces direct a `users`.

## 1. L'option retenue echoue telle que proposee - trois echecs reels, empiles

Verifie par execution, pas par assertion, comme pour `security_invoker` en
Phase 2 : la premiere version litterale de l'option A ne fonctionne pas.
Trois echecs distincts, decouverts et corriges dans l'ordre :

**1a. `edutrack_schema_owner` n'a pas `BYPASSRLS`.** Fonction possedee par
`edutrack_schema_owner` (comme propose initialement), appelee par
`app_role` pour un `google_subject` inconnu :

```
ERROR:  new row violates row-level security policy for table "users"
CONTEXT:  SQL statement "INSERT INTO users (google_subject, email, display_name)
        VALUES (p_google_subject, p_email, p_display_name)
        RETURNING id"
```

`FORCE ROW LEVEL SECURITY` sur `users` s'applique aussi au proprietaire,
sauf s'il a `BYPASSRLS` - ce que `edutrack_schema_owner` n'a jamais eu
(volontairement : voir `infra/bootstrap-roles.sql`, "jamais utilise par
l'app en execution"). La policy `self_only` evalue `app_current_user_id()`,
qui est NULL pour un utilisateur qui n'existe pas encore : le `WITH CHECK`
implicite de l'INSERT echoue necessairement, quel que soit le contenu de
la ligne.

Correction : nouveau role `auth_bootstrap_owner` (`NOLOGIN`, `BYPASSRLS`,
`infra/bootstrap-roles.sql`), dont le seul usage est d'etre proprietaire de
cette fonction. Jamais de mot de passe, jamais de LOGIN, n'apparait dans
aucune chaine de connexion.

**1b. `ALTER FUNCTION ... OWNER TO` exige que le NOUVEAU proprietaire ait
aussi `CREATE` sur le schema.** Transfert de propriete vers
`auth_bootstrap_owner` :

```
ERROR:  permission denied for schema public
```

Reproduit en isolation sur une fonction `probe_fn()` minimale pour
confirmer que c'est bien l'`ALTER FUNCTION ... OWNER TO` qui echoue (pas le
`CREATE FUNCTION` ni le `REVOKE`/`GRANT` suivants, testes separement et
tous les deux reussis seuls). Ce comportement est documente par Postgres
("to alter the owner, you must also be a member of the new owning role,
and that role must have CREATE privilege on the object's schema") mais
n'avait jamais ete rencontre dans ce projet avant cette fonction (la
premiere a changer de proprietaire apres creation).

Correction : `GRANT CREATE ON SCHEMA public TO auth_bootstrap_owner` ajoute
a `infra/bootstrap-roles.sql`.

**Gap non lie, decouvert au passage et corrige par honnetete, pas par
necessite stricte de la fonction** : `GRANT CREATE ON SCHEMA public TO
edutrack_schema_owner` avait ete fait **a la main**, hors de tout fichier
versionne, en Phase 1 (PG15+ restreint par defaut `CREATE` sur le schema
`public` au seul proprietaire de la base - sans ce grant, meme la toute
premiere migration de ce projet echoue). Il n'avait jamais ete consigne
nulle part avant maintenant. Quiconque reconstruirait cette base depuis le
depot seul, en suivant uniquement `infra/bootstrap-roles.sql`, aurait
heurte le meme mur sans le savoir. Corrige dans le meme commit que 1a/1b,
par le meme `GRANT CREATE ON SCHEMA public TO edutrack_schema_owner`
desormais versionne.

**1c. `BYPASSRLS` contourne les POLICIES, pas le controle de privilege de
base sur la table.** Apres 1a et 1b, le meme appel echoue encore
differemment :

```
ERROR:  permission denied for table users
CONTEXT:  SQL statement "SELECT id           FROM users WHERE google_subject = p_google_subject"
```

La migration 6 a fait `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM
PUBLIC`. `auth_bootstrap_owner` est proprietaire de la FONCTION, pas de la
TABLE `users` (toujours possedee par `edutrack_schema_owner`) - `BYPASSRLS`
lui permet d'ignorer les policies RLS, mais ne lui donne aucun privilege
SQL de base (`SELECT`/`INSERT`/`UPDATE`) sur une table qu'il ne possede
pas. Ce sont deux systemes de controle d'acces independants dans Postgres,
pas un seul.

Correction : `GRANT SELECT, INSERT, UPDATE ON users TO auth_bootstrap_owner`
ajoute dans la migration 10 elle-meme (perimetre exact necessaire a la
fonction, rien de plus - jamais `user_unit_grants`).

## 2. Verification finale, par execution

Apres les trois corrections, appel reel en tant que `app_role` :

```sql
SET ROLE app_role;
SELECT find_or_create_user('test-subject-empirique', 'test@empirique.test', 'Test Empirique');
-- cree la ligne, retourne un id
SELECT find_or_create_user('test-subject-empirique', 'nouveau@empirique.test', 'Test Empirique 2');
-- MEME id, email et display_name mis a jour (idempotence confirmee)
```

`app_role` conserve zero GRANT table direct sur `users` et sur
`user_unit_grants` (verifie par requete sur
`information_schema.table_privileges`, A1 intact malgre la fonction).

Tests permanents : `tests/deny/find-or-create-user.test.js` (perimetre de
la fonction : creation, idempotence, jamais `user_unit_grants`, A1 intact,
refus de lecture directe de `users`, `PUBLIC` n'a pas `EXECUTE`).

## 3. Meta-test etendu aux fonctions (avant cette fonction, rien a verifier)

`find_or_create_user` est la toute premiere fonction executable par
`app_role` depuis le debut du projet (les deux fonctions `app_current_*`
de la migration 6 sont des helpers internes aux policies, jamais appeles
directement par `app_role` jusqu'ici au sens de `has_function_privilege` -
en realite elles le sont aussi, verifie : les trois apparaissent). Le
meta-test de Phase 2 (`tests/deny/meta-view-exposure-isolation.test.js`)
ne couvrait que les vues. Etendu avec la meme methode de detection
(`has_function_privilege`, pas une liste ecrite a la main) et la meme
fermeture par defaut (`EXPOSED_FUNCTIONS`, toute fonction exposee et non
declaree fait echouer le test).

`npx vitest run` : 30/30 sur les 6 fichiers de `tests/deny/`. `npx tsc` et
`npx eslint src` silencieux.

## 4. Portee de ce qui suit (framework HTTP non tranche)

Le plan v2 n'a jamais explicitement choisi de framework HTTP (seule une
comparaison incidentale de plancher Node avec Next.js existe dans la
section "Arbitrages dependances actes"). Pour ne pas inventer cette
decision, le code d'authentification de cette phase est ecrit comme des
modules purs, independants de tout framework (fonctions appelables depuis
n'importe quel gestionnaire de route) : verification du jeton Google,
scellement/descellement de session via les primitives bas niveau
`sealData`/`unsealData` d'iron-session (pas les aides specifiques a
Next.js). Le cablage des routes HTTP concretes est reporte a la Phase 8,
quand le framework sera choisi - note explicitement ici pour que la
relecture de Phase 6 ne le prenne pas pour un oubli.
