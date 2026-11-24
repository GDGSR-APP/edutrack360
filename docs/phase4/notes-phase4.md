# Notes Phase 4 - trouvailles empiriques

## 0. Lecture retenue pour "matrice de refus par role et par unite"

Signalee explicitement plutot que decidee en silence (voir aussi le
commentaire d'en-tete de `tests/deny/phase4-matrice-identites-perimetres.test.js`) :
ce depot n'a qu'une seule identite applicative (`app_role` + une ligne
`users`, perimetre defini par `user_unit_grants`) - aucune colonne "role"
(directeur d'unite / direction generale) n'existe dans le schema, et A4
n'en demande pas ("administre a la main"). "Par role" a donc ete
interprete comme les **etats de perimetre** qu'un compte peut avoir, pas
des roles Postgres :

- R1 - aucun contexte applicatif pose du tout
- R2 - authentifie, zero grant
- R3 - authentifie, un seul grant ("directeur d'unite")
- R4 - authentifie, plusieurs grants ("direction generale" - pas de role
  special, juste plusieurs lignes, conforme a A4)
- R5 - `userId` syntaxiquement valide mais sans ligne reelle dans `users`
  (session forgee/perimee)

Croise avec les 4 vues unit-scoped (`v_classes`, `v_periods`, `v_grades`,
`v_student_averages`) et les 2 vues identity-scoped (`v_my_profile`,
`v_my_unit_grants`). 7 tests, tous verifies par execution
(`tests/deny/phase4-matrice-identites-perimetres.test.js`), 71/71 sur
l'ensemble du depot.

## 1. A4 tel que decrit n'est pas executable avec les roles actuels - trouvaille majeure

A4 (plan v2) : "`user_unit_grants` saisi et administre a la main par le
directeur de projet." En verifiant comment cette administration pourrait
reellement se faire, trouve par execution (pas suppose) : **aucun role
operationnel ne peut le faire**.

```sql
-- Connecte en tant que edutrack_schema_owner (PAS le superutilisateur de
-- test) :
INSERT INTO users (google_subject, email) VALUES ('admin-test-subject', 'admintest@p4.test');
-- ERROR:  new row violates row-level security policy for table "users"

INSERT INTO user_unit_grants (user_id, unit_id) SELECT ..., ...;
-- ERROR:  new row violates row-level security policy for table "user_unit_grants"
```

Meme cause mecanique que l'ADR 0001 (`docs/architecture/adr-0001-resolution-identite-premier-login.md`) :
`users` et `user_unit_grants` ont toutes les deux `FORCE ROW LEVEL
SECURITY` + une policy `self_only`, et `edutrack_schema_owner` n'a pas
`BYPASSRLS`. Administrer un grant pour un AUTRE utilisateur que
soi-meme est structurellement bloque, meme pour le role qui possede les
tables.

Seule la connexion de test (`TEST_SUPERUSER_URL`, le superutilisateur
Postgres reel du conteneur ephemere) a pu administrer des grants jusqu'ici
dans ce depot - un acces qui n'existe pas forcement de la meme maniere en
production sur le VPS Coolify (a confirmer avec le directeur de projet,
pas suppose ici).

**Consequence directe** : "administre a la main" tel qu'approuve dans le
plan n'a, pour l'instant, aucun chemin d'execution reel en dehors d'un
acces superutilisateur Postgres direct. Ce n'est pas corrige dans ce
chantier - c'est une decision d'architecture, pas un detail
d'implementation, et elle suit exactement le precedent de l'ADR 0001 (une
decision approuvee qui s'est reveleee irrealisable telle qu'ecrite).

**Options, non tranchees ici :**

- **Option A (parallele a l'ADR 0001)** : deux nouvelles fonctions
  `SECURITY DEFINER` etroites (`grant_unit_access`,
  `revoke_unit_access`), possedees par un NOUVEAU role `BYPASSRLS` dedie
  (pas `auth_bootstrap_owner` - son perimetre est deja garanti exact par
  un meta-test permanent, l'elargir violerait la garantie qui vient
  d'etre actee). `EXECUTE` accorde a `edutrack_schema_owner` uniquement
  (jamais a `app_role` - l'administration reste hors de l'application,
  conforme a "a la main").
- **Option B** : accorder `BYPASSRLS` directement a
  `edutrack_schema_owner`. Rejetee par analogie avec le raisonnement
  deja fait pour `find_or_create_user` (Phase 3) : `BYPASSRLS` sur un
  role qui possede TOUTES les tables contourne RLS partout, pas
  seulement pour cette action precise - rayon d'effet bien plus large
  que necessaire.
- **Option C** : confirmer qu'un acces superutilisateur Postgres direct
  (hors application) est bien ce que "a la main" designait depuis le
  debut, et documenter cet acces (qui le detient, comment, avec quelle
  tracabilite) plutot que d'ajouter du code.

## 2. Decision du directeur de projet : Option A (fonctions SECURITY DEFINER dediees)

Mise en oeuvre (migration `20261124000011_grants_administration.cjs`,
role `grants_admin_owner` dans `infra/bootstrap-roles.sql`) :

- `grant_unit_access(p_user_id, p_unit_id)`, `revoke_unit_access(p_user_id, p_unit_id)`,
  `list_user_unit_grants(p_user_id, p_unit_id)` (parametres optionnels -
  seule visibilite possible sur l'etat courant, puisque meme `SELECT`
  direct sur `user_unit_grants` est bloque par `self_only` pour
  `edutrack_schema_owner`).
- Possedees par un role DEDIE, `grants_admin_owner` (`NOLOGIN`,
  `BYPASSRLS`) - explicitement PAS `auth_bootstrap_owner`, dont le
  perimetre est deja garanti exact par son propre meta-test ; l'elargir
  aurait rompu cette garantie juste actee.
- `EXECUTE` accorde UNIQUEMENT a `edutrack_schema_owner`. Jamais a
  `app_role` - verifie par execution avec le role reel (pas le
  superutilisateur de test) : `permission denied for function
  grant_unit_access` pour `app_role`, succes complet pour
  `edutrack_schema_owner` (grant, lecture, retrait, idempotence dans les
  deux sens).

Les trois corrections mecaniques de l'ADR 0001 ont ete appliquees
PREVENTIVEMENT cette fois (pas redecouvertes a chaud) : `search_path =
''` + qualification `public.*`, `GRANT CREATE ON SCHEMA public` pour le
nouveau role avant tout `ALTER FUNCTION ... OWNER TO`, et le `GRANT
SELECT, INSERT, DELETE` explicite sur la table malgre `BYPASSRLS`. La
migration est passee du premier coup.

**Perimetre garanti par un meta-test permanent**
(`tests/deny/meta-grants-admin-owner-perimeter.test.js`, meme methode que
pour `auth_bootstrap_owner` - detection depuis le catalogue). Preuve qu'il
peut echouer : un `GRANT EXECUTE ... TO app_role` deliberement pose sur
`grant_unit_access` a fait echouer le test immediatement, revoque
ensuite.

**Reconstruction complete depuis zero** (down/up, bootstrap, migrate,
rien a la main) : 84/84 sur 13 fichiers de test. `npx tsc` et `npx eslint
src` silencieux.

A4 a donc desormais un chemin d'execution reel et verifie - "administre a
la main" signifie concretement : un operateur connecte en tant que
`edutrack_schema_owner` appelle ces trois fonctions.
