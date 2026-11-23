# Authentification Google Workspace - verification du perimetre de domaine

## Fait verifie (point 2), source officielle Google

Le controle du domaine organisationnel se fait sur la revendication `hd` du
jeton d'identite (ID token) signe, **jamais** sur le suffixe de l'adresse
electronique.

Lu dans la documentation officielle Google (23/11/2026) :

- La reference OpenID Connect de Google decrit `hd` comme le domaine
  Workspace ou Cloud de l'organisation, present uniquement pour les membres
  d'une organisation, et indique explicitement de verifier cette revendication
  pour restreindre l'acces a des domaines particuliers - et de **ne pas** se
  fier au domaine de l'adresse electronique a cette fin.
  Source : https://developers.google.com/identity/openid-connect/reference
- Le guide de verification cote serveur du jeton Google (Sign-In) montre que
  l'absence de la revendication `hd` signifie que le compte n'appartient pas a
  un domaine heberge ; l'exemple de code Python y compare `idinfo['hd']` au
  domaine attendu (dans l'exemple officiel, cette comparaison est presente en
  commentaire - a activer explicitement, elle n'est pas appliquee par defaut).
  Source : https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- Le parametre `hd` de la requete d'autorisation (`?hd=...`) ne fait que
  filtrer l'affichage du selecteur de compte cote Google : ce n'est **pas** un
  controle de securite. Seule la revendication `hd` presente dans le jeton
  signe, verifiee cote serveur, fait foi.
  Source : https://developers.google.com/identity/sign-in/web/backend-auth

## Consequence pour l'implementation (Phase 3, pas encore ecrite)

- Verification serveur, dans cet ordre, aucune ne remplace les autres :
  emetteur (`accounts.google.com`), audience (client ID du projet),
  expiration, signature (via `openid-client` / `jose`), **puis** revendication
  `hd` comparee a `GOOGLE_WORKSPACE_ALLOWED_DOMAIN`.
- Un jeton sans revendication `hd` (compte personnel, hors organisation) est
  rejete au meme titre qu'un domaine incorrect.
- Le parametre `hd` de la requete d'autorisation peut etre envoye (confort
  d'UX, selecteur de compte filtre), mais ne dispense jamais de la
  verification serveur de la revendication du jeton.
- Email domain matching (verifier le suffixe de `email`) est explicitement
  ecarte comme defaut de securite, pas un raccourci acceptable (point 2).
