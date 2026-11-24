# Rapport de relecture de securite - Phase 6

## LIMITE A LIRE AVANT TOUT LE RESTE

**Cette relecture n'est PAS independante.** Faute d'acces a un modele
d'une autre famille (jetons OpenCode epuises), elle a ete effectuee par
un agent de la meme famille de modeles que celle ayant ecrit le code
relu - l'auteur relit son propre travail, via un sous-agent neuf
(`ecc:security-reviewer`), sans memoire de la conversation de
developpement, en lecture seule, mais **de la meme famille**. Ce n'est
pas une nuance mineure : une relecture independante par un modele
different, ou par un humain, **reste a faire avant toute donnee reelle
d'eleve**. Ce fait est aussi consigne dans
`docs/phase0/controles-en-attente.md`.

Le rapport ci-dessous n'autorise rien par lui-meme. Plusieurs de ses
constats reposent sur la lecture statique de fichiers, pas sur
l'execution reelle des tests qu'il mentionne - l'agent de revue le
precise lui-meme a plusieurs endroits ("Status: Assumed/Unknown"). Seuls
des tests reellement executes decident de ce qui est vrai.

---

## Rapport integral du sous-agent (texte non modifie, hors mise en forme Markdown)

### 1. Perimetre et methode

Fichiers lus directement : les 12 migrations, `infra/bootstrap-roles.sql`,
`infra/backup-database.sh`, `infra/restore-database.sh`,
`infra/docker-compose.test.yml`, `infra/docker-compose.restore-verify.yml`,
`eslint.config.js`, `tsconfig.json`, `package.json`, `.gitignore`,
`.env.example`, `.gitleaks.toml`, `.githooks/pre-commit`,
`.github/workflows/ci.yml`, `.github/workflows/secret-scan.yml`,
`src/auth/google-oidc.ts`, `src/auth/session.ts`, `src/data-access/db.ts`,
`src/data-access/users.ts`, `src/data-access/grades.ts`, tous les
fichiers de `tests/deny/*` et `tests/auth/*` (y compris
`fake-google-idp.js`), le dossier de Phase 6, les deux ADR, les documents
d'architecture, `docs/phase0/controles-en-attente.md`, et des extraits du
plan. Grep sur tout l'arbre (hors `node_modules`) pour les motifs de type
secret et les termes de regles produit.

**Non fait** : aucune execution de `npm test`, `npm run lint`,
`npm run typecheck`, aucune requete SQL, aucune commande docker, aucune
migration. `.env`/`.env.test` n'ont pas ete ouverts (exclus par
`.gitignore`, presence confirmee par listage de repertoire uniquement).
Les notes de phase (`docs/phase0..5/notes-*.md`) n'ont pas ete lues
integralement - seulement utilisees comme references deja citees par le
dossier et les ADR, et leurs affirmations verifiees contre le code/tests
reels plutot qu'acceptees telles quelles. Aucun fichier ecrit, modifie ou
supprime.

Toute affirmation du depot du type "verifie par execution" (par exemple
l'ADR 0002 : "npx vitest run : 90/90... silencieux") est traitee comme
une **affirmation non verifiable** par cette relecture, pas comme un
fait confirme.

### 2. Constats par question prioritaire

#### a. Mecanisme d'isolation par unite

**Mecanisme (Observe) :** policies `unit_isolation_select` (`FOR SELECT
USING (unit_id = ANY (app_current_unit_ids()))`) sur `classes`,
`periods`, `grades`, `student_averages`, combinees a `FORCE ROW LEVEL
SECURITY` sur chacune (migrations 2, 4, 8). `app_current_unit_ids()` lit
un GUC transaction-locale peuple uniquement par `withAuthenticatedContext`
(`src/data-access/db.ts` lignes 35-58) en relisant `v_my_unit_grants`
depuis la base - jamais fourni par l'appelant. Le GRANT est une barriere
separee : `app_role` n'a aucun grant direct sur les tables de base,
seulement sur 11 vues et 3 fonctions.

**Deroulement pour une future vue sans filtre :** si une vue est creee
sans isolation correcte et exposee a `app_role` :
1. `tests/deny/meta-view-exposure-isolation.test.js` la decouvre
   dynamiquement via `has_table_privilege` et echoue si elle n'est pas
   classee dans une des 3 categories declarees - fermeture par defaut.
2. Si elle est ajoutee a une categorie avec une fausse promesse
   d'isolation, le test de preuve d'echec de ce meme fichier demontre
   que ce mode de defaillance est actuellement detecte lorsqu'il est
   exerce. Les fonctions generiques `assertUnitIsolation`/
   `assertIdentityIsolation` levent une erreur explicite si aucune
   fixture n'est enregistree pour une vue declaree - echec bruyant, pas
   un passage silencieux.
3. **Reserve critique (voir constat additionnel ci-dessous) :** rien de
   tout cela ne compte si la suite de tests n'est jamais executee. La CI
   (`.github/workflows/ci.yml`) ne lance que `typecheck` et `lint`,
   jamais `npm test`. Ce mecanisme de detection existe dans le depot mais
   n'a aucun declencheur automatique en CI - il ne s'execute que si un
   humain lance `npm test` manuellement en local.

**Gravite :** Haute (pour le manque de CI specifiquement). Le mecanisme
RLS+GRANT lui-meme est Observe et sain dans sa conception ; l'ecart est
dans le pipeline de verification, pas dans le mecanisme.

#### b. `auth_bootstrap_owner` et `BYPASSRLS`

**Observe**, `infra/bootstrap-roles.sql` lignes 63-69 : `NOLOGIN
BYPASSRLS`, aucun mot de passe (ne peut pas etre connecte directement).
Possede exactement `find_or_create_user`, a recu `SELECT, INSERT,
UPDATE` sur `users` uniquement.

**Rayon d'impact en cas de compromission :** etant `NOLOGIN`, pas
d'identifiants a voler au sens classique. Le chemin de compromission
realiste est "un attaquant qui a deja acces a `edutrack_schema_owner`"
(membre de `auth_bootstrap_owner`, ligne 68) ou "un attaquant qui peut
faire executer du SQL arbitraire sous ce role". Le rayon direct : lire/
ecrire toutes les lignes de `users` en contournant `self_only`. N'inclut
PAS `grades`, `student_averages`, `classes`, `periods`,
`user_unit_grants` (aucun grant sur ces tables - `BYPASSRLS` contourne
les policies, pas le systeme de GRANT, correctement documente et teste).
Risque principal : ce role est a un saut de membership de
`edutrack_schema_owner`, le veritable proprietaire DDL de tout le
schema - si ses identifiants (qui ONT un mot de passe) sont compromis,
l'attaquant herite de `auth_bootstrap_owner` gratuitement, en plus de
tout le reste.

**Couverture de test (lu en detail, pas seulement le nom) :**
`tests/deny/meta-auth-bootstrap-owner-perimeter.test.js` verifie :
relations possedees == vide, fonctions possedees == exactement
`find_or_create_user`, schemas possedes == vide, grants de table ==
exactement `users.SELECT/INSERT/UPDATE`, grants de routine == exactement
`find_or_create_user.EXECUTE`, appartenance a un autre role == aucune,
attributs dangereux tous faux sauf `BYPASSRLS`. **Trou de couverture
identifie en lisant la logique, pas le nom :** ce test ne verifie PAS
la direction inverse de l'appartenance - si un AUTRE role plus puissant
etait un jour rendu membre de `auth_bootstrap_owner` (heritant ainsi de
`BYPASSRLS`), ce test ne le detecterait pas, car sa requete ne regarde
que ce dont `auth_bootstrap_owner` est membre, pas qui est membre de
lui.

**Gravite :** Moyenne. **Statut : Observe** (role et logique du test).

#### c. Verification du jeton Google (`src/auth/google-oidc.ts`)

**Les six controles, enumeres :**
1. **Emetteur** - delegue a `openid-client` (interne a la bibliotheque).
2. **Audience** - idem.
3. **Expiration** - idem.
4. **Signature** - forcee explicitement via `client.enableNonRepudiationChecks`
   (ligne 44), avec commentaire expliquant que la bibliotheque ne la
   verifie pas par defaut sur ce flux - le seul controle dont le code
   prend explicitement la responsabilite plutot que de faire confiance
   au defaut de la bibliotheque.
5. **Revendication `hd`** - explicite, lignes 124-131 : rejet si absente
   OU differente du domaine attendu, jamais de repli sur le suffixe de
   l'email (confirme en lisant toute la fonction).
6. **`email_verified`** - explicite, lignes 120-122 : rejet sauf si
   `=== true` exactement.

**Comportement en cas d'echec :** chaque controle leve `GoogleAuthError`,
jamais intercepte ni avale dans ce fichier - propagation systematique.
Aucun indicateur ou variable d'environnement trouve qui desactiverait
`hd` ou `email_verified`.

Les controles 1-3 dependent entierement de la bibliotheque tierce -
**Statut : Suppose** pour ces trois (hors de portee d'une lecture statique
du seul code du projet). **Statut : Observe** pour 4, 5, 6.

**Verification croisee avec les tests (lus en detail) :** chacun des 6
controles a un `it(...)` correspondant exercant un jeton reellement
casse via un faux IdP local signant de vrais JWT - pas un objet de
revendications simule. Le cas "`hd` absent malgre un email au bon
suffixe" est explicitement teste et prouve l'absence de repli sur le
suffixe. **Jamais teste contre un vrai tenant Google** - signale
explicitement dans `docs/phase0/controles-en-attente.md`. **Statut :
Inconnu** pour l'interoperabilite reelle avec Google.

#### d. Couche d'acces - une requete peut-elle contourner les fonctions/vues ?

**Code d'execution (Observe) :** seul `src/data-access/db.ts` importe
`pg`. `users.ts` et `grades.ts` ne passent que par `find_or_create_user`
ou des vues.

**Regle ESLint (Observe), limites reelles identifiees en lisant sa
configuration exacte, pas son intention :**
1. Le motif est `files: ["**/*.ts"]` uniquement - un fichier `.js`,
   `.mjs`, `.cjs` ou `.tsx` important `pg` ne serait pas detecte du tout.
2. `no-restricted-imports` ne couvre pas `require()` (seulement les
   declarations `import`/`export` ES) - un `const { Pool } =
   require("pg")` dans un fichier `.ts` compile en CommonJS ne serait
   plausiblement pas detecte (le projet est `"type": "commonjs"` et
   utilise deja `require()` ailleurs, ex. `eslint.config.js` lui-meme).
3. Import dynamique `import()` - comportement non verifie, ni confirme
   ni exclu.
4. Import par sous-chemin (`pg/lib/...`) - la regle compare la chaine
   exacte `"pg"`, un sous-chemin ne correspondrait pas.
5. `eslint src` ne couvre que `src/` - un futur repertoire hors `src/`
   ne serait jamais analyse par cette regle.

**Conclusion :** rien n'est actuellement exploite (le code reel est
propre), mais l'affirmation du dossier ("structurellement impossible")
est **surevaluee** pour ce qui concerne specifiquement la regle de lint -
elle est un frein reel contre le cas courant, pas une impossibilite
structurelle contre `require()`, les sous-chemins, les fichiers non-`.ts`
ou hors `src/`. La vraie garantie structurelle reste la combinaison
RLS+GRANT au niveau base de donnees, independante de cette regle de
lint.

**Gravite :** Basse/Informationnelle en pratique aujourd'hui ; **Moyenne**
en tant qu'ecart entre la documentation et la configuration reelle de la
regle. **Statut : Observe.**

#### e. Secrets

**Rien trouve dans les fichiers suivis qui ressemble a un identifiant
reel.** `infra/bootstrap-roles.sql` : substitutions psql uniquement.
`.env.example` : noms de variables, valeurs vides. Les deux
`docker-compose.*.yml` contiennent des mots de passe litteraux
(`edutrack_super_test_local_only`, `restore_verify_local_only`) -
**jugement : synthetiques/locaux uniquement**, suffixes explicitement
`_local_only`, lies a `localhost` pour des conteneurs Docker jetables,
sans rapport avec la production. Traite comme non-constat
(Informationnel au plus). Les tests generent `CLIENT_SECRET` via
`randomBytes` a l'execution, jamais une valeur litterale committee.
Aucune cle privee, aucune chaine de connexion reelle, aucune cle d'API
trouvee. `.env`/`.env.test` existent sur le disque (confirme par
listage) mais sont exclus par `.gitignore` et n'ont pas ete ouverts.

**Posture de scan de secrets (ecart reel, distinct de "aucun secret
trouve") :** `.githooks/pre-commit` degrade en avertissement (`exit 0`)
quand `gitleaks` est absent - et il l'est sur toute machine ayant servi
a ce depot selon `docs/phase0/controles-en-attente.md`. **Consequence :
tous les commits de l'historique de ce depot sont passes en mode degrade,
sans blocage reel jamais declenche.** Le workflow CI `secret-scan.yml`
existe et s'executerait en principe sur push/PR, mais rien dans les
fichiers statiques ne permet de confirmer qu'il a deja reellement tourne
avec succes. **Statut : Observe** pour le hook local degrade ; **Inconnu**
pour l'execution reelle du workflow CI.

**Gravite :** Basse pour l'etat actuel (aucun secret reel trouve) ;
**Moyenne** comme ecart de processus (le blocage local n'a jamais ete
reellement exerce).

#### f. Les trois regles produit

Recherche dans `src/` (grep sur les termes pertinents) : **zero
occurrence dans `src/`.** Tout se trouve uniquement dans la documentation
et les commentaires de migration.

1. **Seuil de silence du signal de capacite d'accompagnement :**
   purement declaratif aujourd'hui au niveau application. `v_support_signal_config`
   filtre `WHERE validated_at IS NOT NULL` - mecanisme reel au niveau
   base de donnees (une table vide/non validee ne renvoie aucune ligne).
   Mais **aucun code dans `src/` ne calcule ni n'affiche jamais ce
   signal** - la logique de calcul et l'UI/API sont prevues en Phase 8,
   non construites. **Verdict : partiellement applique au niveau vue
   (silence reel), mais la regle metier "ne jamais substituer
   silencieusement une valeur" n'a pas encore de code applicatif a
   faire respecter.**
2. **Mention obligatoire ("capacite d'accompagnement, pas un
   diagnostic", A6) :** declaree uniquement dans le plan, prevue Phase 8.
   **Aucun code dans `src/`** - il n'existe encore aucune couche UI a
   laquelle l'attacher. **Verdict : intention documentaire uniquement,
   zero code.**
3. **Citation des elements sous-jacents d'une alerte :** **regle
   introuvable** telle que formulee, nommement et separement, dans la
   documentation actuelle du depot. La regle documentee la plus proche
   est celle de FRAICHEUR (date du dernier chargement ETL reussi,
   `etl_load_runs` + `v_latest_successful_etl_run`, mecanisme reellement
   applique) - mais ce n'est pas la meme affirmation que "citer les
   elements sous-jacents d'un classement/signal". **A traiter comme une
   question ouverte a poser a qui a formule cette priorite de relecture,
   pas a affirmer comme appliquee ou seulement declaree, puisque la
   regle elle-meme n'a pas ete localisee.** **Statut : Inconnu** (regle
   non localisee).

### 3. Constats additionnels hors a-f

**Constat : la CI ne lance jamais la suite de tests - tout le narratif
"verifie par execution" n'est garanti par aucune porte automatique.**
- Gravite : **Haute.**
- Fichier/lignes : `.github/workflows/ci.yml` (1-17) ne definit qu'un
  job `lint-and-typecheck`. `package.json` definit `"test": "vitest
  run"` (ligne 10), jamais invoque par aucun workflow.
- Pourquoi c'est important : chaque fichier de test lu (tests de
  zero-grant A1, meta-couverture RLS, meta-exposition-isolation des
  vues, les deux meta-tests de perimetre de role, l'invariant
  zero-grant, la matrice complete de refus OIDC) est un test
  reellement construit et fonctionnel - mais aucun ne tourne
  automatiquement sur push ou PR. Ils exigent un Postgres actif, un
  `.env.test` rempli, et un humain qui tape `npm test`. Une regression
  exacte du type de celle deja survenue dans ce projet (la fuite `FOR
  ALL` entre les migrations 7 et 8) pourrait etre reintroduite et
  mergee sans qu'aucun test automatique ne la detecte jamais.
- Test qui l'aurait detecte : en principe `a1-zero-grant.test.js`,
  `meta-rls-coverage.test.js`, `meta-view-exposure-isolation.test.js` -
  **si executes**. Aujourd'hui, aucun processus automatise ne les lance.
- Statut : **Observe.**

**Constat positif : `grant_audit_log` est reellement append-only, pas
seulement par convention.** Seuls `SELECT, INSERT` sont accordes a
`grants_admin_owner`, aucun `UPDATE`/`DELETE` nulle part. **Observe.**

**Constat positif : la discipline `search_path = ''` est appliquee de
maniere constante** sur toutes les fonctions `SECURITY DEFINER` revues
(`find_or_create_user`, `grant_unit_access`, `revoke_unit_access`,
`list_user_unit_grants`, les deux versions). **Observe.**

### 4. Verdict final

La conception d'isolation au niveau Postgres (RLS + FORCE RLS + zero
grant sur les tables de base + roles `BYPASSRLS` etroitement confines
avec meta-tests permanents) est saine et appuyee par des tests qui, lus
ligne a ligne, verifient reellement ce que leur nom affirme - y compris
de vraies preuves d'echec (la vue fautive, la reproduction du
detournement de table temporaire, le bug historique `FOR ALL`). La
verification du jeton Google est correcte sur chaque point que
l'architecture exige, avec une vraie matrice de tests cryptographiques
contre un faux IdP local.

Cependant, la posture de risque globale **n'est pas encore celle d'un
systeme a qui confier des donnees reelles d'eleves**, pour des raisons
de processus et de pipeline de verification, pas de conception :

1. Le filet de securite le plus important de ce depot (la suite
   deny/meta) **n'est pas branche a la CI**. Tout ce qui rend cette
   conception fiable EN PRINCIPE depend d'humains se souvenant de lancer
   `npm test` localement avant chaque changement touchant aux
   migrations, grants, policies ou a l'authentification.
2. Plusieurs affirmations d'"impossibilite structurelle" sont, a lecture
   fine, plutot des "freins forts pour le cas courant" - notamment la
   regle ESLint sur `pg`.
3. Trois categories de controles sont explicitement non testees contre
   la realite : vrais jetons Google, comportement SameSite en
   navigateur reel, isolation reseau reelle - deja signale par le projet
   lui-meme, mais cela signifie que l'authentification et l'isolation
   reseau sont aujourd'hui correctes EN THEORIE, pas confirmees
   EMPIRIQUEMENT hors d'un harnais de test synthetique.
4. L'hygiene des secrets est propre aujourd'hui, mais le seul verrou
   automatique local cense l'empecher n'a jamais reellement bloque quoi
   que ce soit dans l'historique de ce depot.

Rien de tout cela ne suggere une equipe negligente - l'auto-documentation
est meilleure que la plupart des depots que ce genre de relecture
rencontre habituellement. Mais des ecarts bien documentes restent des
ecarts, et celui du filet de securite qui ne tourne pas automatiquement
est le genre de chose qui s'erode silencieusement au fil des mois sans
correction avant tout contact avec des donnees reelles d'eleves.

### 5. Conditions avant de faire confiance a ce depot pour des donnees reelles

1. **Brancher la suite de tests a la CI**, au minimum `tests/deny/*` et
   `tests/auth/*`, contre un Postgres ephemere demarre dans le job
   lui-meme.
2. **Durcir ou documenter honnetement la regle de lint sur `pg`** -
   couvrir `require()`, les sous-chemins, les emplacements hors
   `src/**/*.ts`, ou cesser de la decrire comme rendant l'acces direct
   "structurellement impossible".
3. **Installer gitleaks au moins sur le chemin CI et verifier qu'il
   bloque reellement un faux secret pose deliberement, une fois.**
4. **Exercer l'authentification contre un vrai tenant Google Workspace**
   avant la mise en production, y compris le comportement SameSite en
   navigateur reel.
5. **Executer le test de connectivite reseau negatif** decrit dans la
   documentation de topologie, sur le deploiement reel, avant tout
   lancement de l'ETL contre la source de production.
6. **Clarifier la regle "citer les elements sous-jacents"** (point f.3) -
   confirmer si elle existe reellement et ou, avant que la Phase 8 ne
   construise l'UI sans elle.
7. **Avant toute donnee reelle d'eleve, faire executer la suite complete
   par un second relecteur reellement independant** (capable d'executer
   les tests, contrairement a cette relecture) et confirmer l'affirmation
   "90/90" qui ne repose aujourd'hui que sur une affirmation documentaire.
