# EduTrack360

Plateforme pour un reseau de 18 ecoles privees au Maroc. Base applicative
PostgreSQL alimentee en lecture seule depuis une Supabase de production
existante, jamais modifiee par l'application. Portail pour directeurs
d'unite et direction generale. Premier livrable : le socle (identites,
perimetres, referentiels) et le module notes en lecture seule.

**Statut : Phase 4 en cours** (identites et perimetres - matrice de refus
livree ; administration des grants "a la main" en attente d'une decision
d'architecture, cf. `docs/phase4/notes-phase4.md`). Phases 0-3 terminees
et documentees (`docs/phase0/` a `docs/phase3/`).

## Documentation

- [`docs/plan/plan-v2-edutrack360.md`](docs/plan/plan-v2-edutrack360.md) -
  plan approuve, version durable.
- [`docs/architecture/topologie-reseau.md`](docs/architecture/topologie-reseau.md) -
  isolation reseau Docker, role de l'ETL.
- [`docs/architecture/authentification-google.md`](docs/architecture/authentification-google.md) -
  verification du domaine via la revendication `hd`.
- [`docs/architecture/signal-accompagnement-et-fraicheur.md`](docs/architecture/signal-accompagnement-et-fraicheur.md) -
  seuils non codes en dur, date de fraicheur obligatoire.
- [`docs/architecture/adr-0001-resolution-identite-premier-login.md`](docs/architecture/adr-0001-resolution-identite-premier-login.md) -
  la decision approuvee (fonction possedee par edutrack_schema_owner)
  s'est revelee impossible par execution ; ce qui la remplace et pourquoi.
- [`docs/phase0/journal-questions-juridiques.md`](docs/phase0/journal-questions-juridiques.md) -
  questions loi 09-08 ouvertes, bloquent la production, pas le developpement.
- [`docs/phase0/autorisation-etl-source-lecture.md`](docs/phase0/autorisation-etl-source-lecture.md) -
  **brouillon**, non envoye.
- [`docs/phase0/signalement-etat-source.md`](docs/phase0/signalement-etat-source.md) -
  **brouillon**, non envoye.
- [`docs/phase0/controles-en-attente.md`](docs/phase0/controles-en-attente.md) -
  blocage de commit par gitleaks jamais declenche reellement (gitleaks non
  installe) - controle en attente, pas invente comme demontre.
- [`docs/phase1/notes-phase1.md`](docs/phase1/notes-phase1.md) - ecart de
  sequence TDD signale pour la relecture Phase 6, non corrige retroactivement.
- [`docs/phase2/notes-phase2.md`](docs/phase2/notes-phase2.md) - repli
  TypeScript 5.x verifie, vues DEFINER-style (pas security_invoker, trouve
  empiriquement), fuite RLS trouvee et corrigee, preuve d'execution de la
  regle de lint.
- [`docs/phase4/notes-phase4.md`](docs/phase4/notes-phase4.md) - matrice de
  refus par etat de perimetre livree ; A4 ("administre a la main") sans
  chemin d'execution reel avec les roles actuels - decision en attente.
- [`docs/phase3/notes-phase3.md`](docs/phase3/notes-phase3.md) - resolution
  d'identite au premier login (find_or_create_user), trois echecs reels
  empiles (self_only/BYPASSRLS, ALTER OWNER, grant table) corriges et
  verifies par execution ; openid-client ne verifie pas la signature du
  jeton par defaut (TLS seul) - corrige par enableNonRepudiationChecks.

## Garde-fous

- `.gitleaks.toml` + `.githooks/pre-commit` : scan de secrets local (active
  par `git config core.hooksPath .githooks`).
- `.github/workflows/secret-scan.yml` : scan de secrets en CI.
- `.env.example` : noms de variables uniquement, aucune valeur.
