# ADR 0001 - Resolution d'identite au premier login : proprietaire de find_or_create_user

**Statut** : Accepte (directeur de projet, Phase 3->4). Premier ADR de ce
projet - sert de modele pour les ecarts d'architecture suivants.

## Contexte

A1 interdit tout GRANT table direct pour `app_role`. `users` est
verrouillee par la policy `self_only` sous `FORCE ROW LEVEL SECURITY`
(filtre `id = app_current_user_id()`). Au premier login d'un compte
Google jamais vu, son id applicatif n'existe pas encore - rien ne peut
etre "soi-meme" avant d'exister dans la table. Il fallait un mecanisme de
resolution/creation d'identite qui ne contredise ni A1 ni `self_only`.

## Decision approuvee initialement

Le directeur de projet a choisi, entre deux options proposees, une
**fonction `SECURITY DEFINER` etroite** (`find_or_create_user`), plutot
qu'un role de connexion separe avec acces direct a `users`. La
formulation approuvee precisait : "possedee par `edutrack_schema_owner`,
EXECUTE accorde uniquement a `app_role`, REVOKE de PUBLIC, search_path
fixe."

## Ce qui s'est revele impossible, par execution

Verifie empiriquement (`docs/phase3/notes-phase3.md`, section 1), pas
suppose : une fonction `SECURITY DEFINER` possedee par
`edutrack_schema_owner` echoue reellement sur un `google_subject`
inconnu :

```
ERROR:  new row violates row-level security policy for table "users"
```

`FORCE ROW LEVEL SECURITY` s'applique AUSSI au proprietaire de la table,
sauf s'il a l'attribut `BYPASSRLS`. `edutrack_schema_owner` ne l'a jamais
eu - c'est voulu, documente dans `infra/bootstrap-roles.sql` comme
"jamais utilise par l'app en execution". La policy `self_only` evalue
`app_current_user_id()`, qui est NULL pour un utilisateur qui n'existe pas
encore : le `WITH CHECK` implicite de l'INSERT echoue necessairement,
quel que soit le contenu de la ligne. La decision approuvee au mot pres
etait donc irrealisable telle qu'ecrite - pas un detail d'implementation,
une impossibilite mecanique du moteur.

## Ce qui remplace la decision initiale

Nouveau role **`auth_bootstrap_owner`** : `NOLOGIN`, `BYPASSRLS`, aucun
mot de passe, n'apparait dans aucune chaine de connexion
(`infra/bootstrap-roles.sql`). Son seul usage est d'etre proprietaire de
`find_or_create_user`. `app_role` continue de n'avoir **aucun** GRANT
table direct (A1 intact) - seulement `EXECUTE` sur cette fonction.

Perimetre exact, verifie par execution et garanti par un meta-test
permanent (`tests/deny/meta-auth-bootstrap-owner-perimeter.test.js`,
detection depuis le catalogue systeme, pas une liste ecrite a la main) :

- Possede exactement 1 objet : la fonction `find_or_create_user`. Aucune
  table, vue, sequence, schema.
- Recoit exactement `SELECT, INSERT, UPDATE` sur `users` - jamais sur
  `user_unit_grants`, jamais sur une autre table.
- N'est membre d'aucun autre role (aucun privilege herite).
- Aucun attribut de role dangereux au-dela de `BYPASSRLS` lui-meme
  (`rolsuper`, `rolcreaterole`, `rolcreatedb`, `rolcanlogin`,
  `rolreplication` sont tous faux).

Deux corrections mecaniques supplementaires, decouvertes par la meme
demarche empirique et documentees dans `docs/phase3/notes-phase3.md`
(sections 1b, 1c) :

- `ALTER FUNCTION ... OWNER TO` exige que le NOUVEAU proprietaire ait
  aussi `CREATE` sur le schema contenant la fonction - ajoute a
  `infra/bootstrap-roles.sql`.
- `BYPASSRLS` contourne les POLICIES RLS, pas le controle de privilege de
  base sur la table - le `GRANT SELECT, INSERT, UPDATE ON users TO
  auth_bootstrap_owner` ci-dessus etait necessaire independamment de
  `BYPASSRLS`.

## Consequences

- Le tableau des roles du plan (`docs/plan/plan-v2-edutrack360.md`) est
  passe de 4 roles actes a 4 + 1 ajoute en Phase 3, pour une raison
  mecanique et non anticipee - pas une derive de perimetre volontaire.
- `BYPASSRLS` est un attribut puissant ; son usage est accepte ici
  precisement parce qu'il est confine a un role qui ne se connecte
  jamais et ne possede qu'un seul objet etroit. Le meta-test de perimetre
  est la garde-fou qui rend cette confiance verifiable en continu, pas
  seulement vraie au moment de l'ecrire.
- Toute vulnerabilite trouvee ensuite dans `find_or_create_user`
  elle-meme (ex. le detournement de `search_path` via table temporaire,
  corrige en Phase 3) est un risque amplifie par `BYPASSRLS` - la fonction
  doit rester le point le plus etroitement audite de toute la base de
  code serveur.
