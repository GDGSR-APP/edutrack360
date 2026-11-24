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

Phase 4 s'arrete a ce point sur la question de l'administration - la
matrice de refus (section 0) est livree et verifiee ; le mecanisme
d'administration ne l'est pas, en attente de la decision du directeur de
projet.
