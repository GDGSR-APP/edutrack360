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

## 4. openid-client ne verifie PAS la signature du jeton par defaut - trouvaille majeure

En construisant la matrice de refus (`tests/auth/google-oidc.test.js`), le
cas "signature invalide" (jeton signe avec une cle absente du JWKS publie)
a d'abord **reussi a passer la verification** - c'est-a-dire que
`verifyGoogleCallback` a accepte un jeton forge. Isole par execution (pas
par lecture de code) : un script autonome confirme que `jose` lui-meme
rejette correctement une signature croisee entre deux cles RSA
(`jwtVerify` -> `signature verification failed`), donc le probleme n'etait
pas dans la cryptographie, mais dans ce que `openid-client`
verifie reellement par defaut.

Documentation officielle de `enableNonRepudiationChecks()` (citee telle
que recuperee via Context7) :

> Validating signatures of JWTs received via direct communication between
> the client and a TLS-secured endpoint (which it is here) is not
> mandatory since the TLS server validation is used to validate the
> issuer instead of checking the token signature. You only need to use
> this method for non-repudiation purposes.

Sur le flux Authorization Code (jeton recu directement du token endpoint,
pas via un fragment d'URL), `openid-client` considere par defaut que le
canal TLS authentifie deja l'emetteur et NE VERIFIE PAS la signature JWS
du jeton d'identite. C'est un choix de conception documente et legitime en
general - mais le plan de ce projet exige la verification de signature
comme **controle explicite et independant**, pas une consequence
indirecte de la confiance TLS (`docs/plan/plan-v2-edutrack360.md`, A2 :
"verification serveur : emetteur, audience, expiration, signature").

Corrige : `createGoogleOidcConfig` appelle desormais
`client.enableNonRepudiationChecks` dans le tableau `execute` de la
decouverte, systematiquement. Reverifie par execution : le meme cas de
signature forgee echoue desormais (`tests/auth/google-oidc.test.js`,
11/11). Sans cette trouvaille, la Phase 3 aurait livre une verification de
signature qui n'en etait pas une dans ce mode d'usage - le code aurait eu
l'air correct (il appelle bien une bibliotheque OIDC reputee) sans l'etre
pour cette exigence precise.

## 5. Cookies : deux scellements separes, pour une raison structurelle

Documente dans `src/auth/session.ts`, resume ici : le cookie de session
(apres login) est `sameSite=strict`. Le cookie du flux de login
(code_verifier/state/nonce, pose avant la redirection vers Google) ne peut
PAS etre `strict` - un navigateur ne renvoie pas un cookie `strict` sur la
navigation de retour initiee par un tiers (Google) vers `/callback`. Ce
cookie-ci est `sameSite=lax`, duree de vie courte (10 minutes), mot de
passe de scellement different de celui du cookie de session - aucun des
deux ne doit pouvoir se faire passer pour l'autre.

Non verifie dans un navigateur reel a ce stade (aucune route HTTP n'existe
encore - section 6). A verifier explicitement en Phase 8 avant de
considerer le login termine.

## 6. Portee de ce qui suit (framework HTTP non tranche)

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

## 7. Etat des tests apres la premiere passe (avant relecture independante)

`npx vitest run` : 43/43 sur 8 fichiers (`tests/deny/` x6,
`tests/auth/google-oidc.test.js` matrice de refus 11/11,
`tests/auth/zero-grant-invariant.test.js` invariant + bras de controle
2/2). `npx tsc` et `npx eslint src` silencieux. `npm audit` sur
`openid-client@6.9.1`, `jose@6.2.18`, `iron-session@9.1.1` : aucun nouvel
avis (seuls les 3 avis moderes transitifs de `node-pg-migrate`, deja
acceptes dans le plan, restent presents).

## 8. Relecture independante avant de clore ce chantier - trouvailles et corrections

Une relecture independante (outil `advisor`) a ete demandee avant de
rapporter la Phase 3 comme terminee. Elle a trouve une vraie
vulnerabilite et plusieurs trous de couverture reels, pas des
ameliorations cosmetiques.

**8a. `find_or_create_user` etait vulnerable au detournement de
`search_path` (table temporaire).** Reproduit par execution, pas suppose :
en tant que `app_role`, `CREATE TEMP TABLE users (...)`, `GRANT ALL ON
users TO PUBLIC`, puis `SELECT find_or_create_user(...)` - la fonction a
lu et ECRIT dans cette table temporaire au lieu de `public.users` (elle a
retourne l'id de la ligne temporaire et modifie son contenu). `SET
search_path = public` cherche `pg_temp` AVANT tout schema explicite, meme
quand "public" seul est demande. Corrige : `SET search_path = ''` + chaque
reference qualifiee `public.users` explicitement. Reverifie par execution :
la meme attaque echoue desormais, la vraie table `public.users` recoit la
ligne, la table temporaire reste intacte (`tests/deny/find-or-create-user.test.js`,
test permanent ajoute). Au meme endroit, le `SELECT` puis `INSERT` separes
(fenetre de course entre deux premiers logins concurrents du meme
`google_subject`) a ete remplace par un `INSERT ... ON CONFLICT ... DO
UPDATE ... RETURNING id` atomique.

**8b. `src/auth/session.ts` n'avait aucun test.** C'est pourtant l'une des
exigences explicites du directeur de projet (cookie httpOnly/sameSite/secure,
aucun jeton stocke). Ajoute : `tests/auth/session.test.js` (9 tests) -
options de cookie des deux types, round-trip exact du contenu scelle,
sceau altere/mauvais mot de passe/mauvais type de contenu redevenant
`null` plutot qu'une erreur ou un id invente, separation stricte entre
les deux mots de passe de scellement.

**8c. Garde-fou HTTP non teste.** Ajoute : un test confirmant que
`createGoogleOidcConfig` sans `allowInsecureDiscoveryForTestsOnly` rejette
l'emetteur HTTP du faux IdP (le drapeau n'est pas actif par defaut).

**8d. Verification par mutation de l'invariant central.** Le standard
d'empirisme de ce depot (cf. la vue fautive en Phase 2) applique a notre
propre test : `withAuthenticatedContext` a ete temporairement modifie pour
lire les unites depuis `v_units` (toutes les unites) au lieu de
`v_my_unit_grants`. Resultat : 3 des 4 tests du fichier ont echoue
immediatement, avec des diffs montrant les vraies notes des deux unites
apparaissant a tort. Revert, 56/56 a nouveau vert. Le test de l'invariant
est donc prouve capable d'echouer, pas seulement observe en train de
passer.

**8e. L'invariant ne portait que sur `v_grades`.** Etendu a
`v_classes`/`v_periods`/`v_student_averages` dans les deux bras (0 ligne
sans grant, puis exactement l'unite A apres un grant).

**8f. Question posee au directeur de projet, non tranchee ici.** Un
utilisateur SANS AUCUN grant voit malgre tout les referentiels globaux
(`v_units`, `v_levels`, `v_subjects` - noms des 18 ecoles, niveaux,
matieres), par design de la categorie `GLOBAL_VIEWS` (Phase 2). Mesure par
execution, pas decide : est-ce acceptable qu'un compte Google Workspace
valide mais sans aucune affectation voie la liste des noms d'etablissements
du reseau ? Si non, ces vues devraient devenir identity/unit-scoped ou
retirees de ce qui est expose a `app_role` avant toute donnee reelle.

**8g. Valeur de test non revue dans le depot.** `CLIENT_SECRET =
"test-client-secret"` (litteral) remplace par
`randomBytes(32).toString("hex")` dans les deux fichiers qui l'utilisaient
- le faux IdP ne la valide pas, mais la regle du depot ne fait pas
d'exception pour une valeur non exploitable non plus.

**8h. Reconstruction complete depuis zero, sans aucune etape manuelle.**
`npm run db:test:down` puis `up`, bootstrap des roles et migrations
executes UNIQUEMENT via les scripts versionnes (aucune commande `GRANT`
tapee a la main cette fois) : la 56/56 passe. Confirme que le gap
decouvert en section 1 (GRANT CREATE ON SCHEMA public jamais versionne)
etait bien le seul, et qu'il est desormais corrige dans
`infra/bootstrap-roles.sql`.

**8i. Dit ici, pas corrige :**
- Le role `auth_bootstrap_owner` a ete approuve par le directeur de projet
  sous la forme "fonction possedee par `edutrack_schema_owner`" - qui s'est
  revelee impossible. Le role BYPASSRLS, les grants de table, et le GRANT
  CREATE ajoutes sont une consequence mecanique, pas la decision initiale
  telle qu'approuvee au mot pres. A faire reconnaitre explicitement par le
  directeur de projet, pas juste a signaler en passant.
- La frontiere de confiance de `withAuthenticatedContext` : elle fait
  confiance au `userId` qu'on lui passe. Ce `userId` ne doit JAMAIS
  provenir d'ailleurs que d'un sceau de session descellee avec succes -
  aucune autre source n'est actuellement validee comme sure. Cette regle
  n'est nulle part appliquee par du code (aucune route n'existe encore,
  section 6) - seulement par convention, a surveiller en Phase 8.
- CI (`.github/workflows/ci.yml`) ne lance toujours aucun test de base de
  donnees - seulement lint/typecheck. Aucun des tests de ce chantier n'a
  jamais tourne sur un runner reel.
- Ecart de sequence TDD : la migration 10 et les modules d'authentification
  ont ete ecrits avant leurs tests, comme en Phase 1 - signale, pas corrige
  retroactivement.
- Deux controles ajoutes a `docs/phase0/controles-en-attente.md` : jamais
  teste contre un vrai compte Google (seul le faux IdP a tourne) ; le
  comportement SameSite des cookies n'a jamais ete verifie dans un
  navigateur reel (aucune route HTTP n'existe).
