# Notes Phase 5 - sauvegarde, restauration, retour arriere

## 1. Sauvegarde : echoue bruyamment sans superutilisateur/BYPASSRLS

`pg_dump` en tant que `edutrack_schema_owner` (proprietaire des tables,
mais sans `BYPASSRLS`) echoue immediatement et explicitement :

```
pg_dump: error: query failed: ERROR:  query would be affected by row-level security policy for table "classes"
HINT:  To disable the policy for the table's owner, use ALTER TABLE NO FORCE ROW LEVEL SECURITY.
```

`FORCE ROW LEVEL SECURITY`, present sur toutes les tables unit-scoped,
s'applique aussi au proprietaire sans `BYPASSRLS` - `pg_dump` demande
`SET row_security = off` par defaut, ce qui echoue plutot que de
contourner silencieusement. C'est un echec SUR, pas une sauvegarde
silencieusement incomplete. Consequence directe : la sauvegarde doit
etre executee avec des identifiants superutilisateur (ou un role
`BYPASSRLS`), jamais `edutrack_schema_owner`. Script :
`infra/backup-database.sh` (format custom `pg_dump`, verifie par
execution contre le conteneur de test - dump de 13 tables reussi en tant
que superutilisateur).

## 2. Restauration testee hors production - deux echecs reels, un succes complet

Jamais testee contre le conteneur de developpement/test lui-meme :
conteneur Postgres entierement separe
(`infra/docker-compose.restore-verify.yml` - port 55433, identifiants
distincts, projet Docker distinct `edutrack-restore-verify`).

**Premier essai, echec partiel (35 erreurs, non bloquant mais informatif) :**
restauration dans un cluster frais SANS avoir prealablement execute
`infra/bootstrap-roles.sql`. Chaque instruction `GRANT ... TO app_role`
(ou `auth_bootstrap_owner`, `grants_admin_owner`, `test_rls_probe`)
echoue avec `role "..." does not exist`. Cause : `pg_dump` d'une seule
base ne sauvegarde JAMAIS les roles - ce sont des objets de CLUSTER, pas
de base (il faudrait `pg_dumpall --roles-only` pour ca, separement).
Le schema et les DONNEES ont neanmoins ete correctement restaures
(confirme : `pgmigrations` contient 12 lignes dans la source ET dans la
cible malgre les erreurs de GRANT) - seules les permissions finales
manquaient.

**Procedure correcte, verifiee par execution :**
1. `infra/bootstrap-roles.sql` sur le cluster cible (les 6 roles).
2. `pg_restore` de la sauvegarde.

Avec cet ordre : restauration complete, **zero erreur**. Verifie en
detail : proprietaires de table corrects (`edutrack_schema_owner`,
restaures correctement car le role existait avant restauration), A1
intact (`app_role` : zero grant sur `classes`, `SELECT` sur `v_classes`
uniquement), `FORCE ROW LEVEL SECURITY` intacte sur `classes`, les 4
fonctions (`find_or_create_user`, `grant_unit_access`,
`revoke_unit_access`, `list_user_unit_grants`) presentes avec leurs
signatures exactes.

**Verification poussee au maximum** : la suite complete de tests
(`npx vitest run`, 90 tests) a ete executee avec `.env.test` pointant
temporairement vers la base restauree (port 55433) - **90/90**, preuve
d'equivalence FONCTIONNELLE, pas seulement structurelle. `.env.test`
restaure a son contenu reel immediatement apres, reconfirme a 90/90
contre le conteneur de developpement normal.

Scripts : `infra/backup-database.sh`, `infra/restore-database.sh` (tous
deux documentent ces deux contraintes dans leurs commentaires d'en-tete).

## 3. Retour arriere : les 12 migrations annulees une par une, sans erreur

`node-pg-migrate down 1` execute 12 fois consecutives, dans l'ordre
inverse de creation (migration 12 -> migration 1), chacune verifiee
individuellement sans erreur :

```
20261124000012_grants_audit_trail    -> OK
20261124000011_grants_administration -> OK
20261124000010_find_or_create_user   -> OK
20261123000009_access_layer_views    -> OK
20261123000008_fix_write_policy_select_leak -> OK
20261123000007_rls_write_policies    -> OK
20261123000006_rls_policies_and_grants -> OK
20261123000005_support_signal_and_etl_runs -> OK
20261123000004_grades_and_averages   -> OK
20261123000003_users_and_grants      -> OK
20261123000002_unit_scoped_referentials -> OK
20261123000001_referentials          -> OK
```

Schema confirme VIDE apres les 12 (`\dt` : seulement `pgmigrations`
subsiste, geree par node-pg-migrate lui-meme ; `\df` : aucune fonction).
`node-pg-migrate up` ensuite reconstruit l'integralite des 12 migrations
sans erreur, `npx vitest run` confirme **90/90** a nouveau.

Les roles (`auth_bootstrap_owner`, `grants_admin_owner`, etc.) et leur
bootstrap ne sont PAS couverts par ce retour arriere - ils vivent hors
du pipeline de migrations, dans `infra/bootstrap-roles.sql`, par
necessite (`edutrack_schema_owner` n'a pas `CREATEROLE`). Un retour
arriere complet de l'infrastructure impliquerait aussi de retirer ces
roles manuellement si necessaire - non teste ici, hors perimetre de "un
script de retour arriere par migration".

## 4. Etat final

`npx vitest run` : 90/90 sur 13 fichiers, a la fois contre le conteneur
de developpement normal et contre la base restauree. `npx tsc` et `npx
eslint src` silencieux. Aucune donnee reelle n'a jamais existe dans
aucune des bases manipulees - uniquement des fixtures de test, creees et
detruites par les tests eux-memes.
