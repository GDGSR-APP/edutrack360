# EduTrack360

Plateforme pour un reseau de 18 ecoles privees au Maroc. Base applicative
PostgreSQL alimentee en lecture seule depuis une Supabase de production
existante, jamais modifiee par l'application. Portail pour directeurs
d'unite et direction generale. Premier livrable : le socle (identites,
perimetres, referentiels) et le module notes en lecture seule.

**Statut : Phase 0 en cours.** Aucun code applicatif n'existe encore.

## Documentation

- [`docs/plan/plan-v2-edutrack360.md`](docs/plan/plan-v2-edutrack360.md) -
  plan approuve, version durable.
- [`docs/architecture/topologie-reseau.md`](docs/architecture/topologie-reseau.md) -
  isolation reseau Docker, role de l'ETL.
- [`docs/architecture/authentification-google.md`](docs/architecture/authentification-google.md) -
  verification du domaine via la revendication `hd`.
- [`docs/architecture/signal-accompagnement-et-fraicheur.md`](docs/architecture/signal-accompagnement-et-fraicheur.md) -
  seuils non codes en dur, date de fraicheur obligatoire.
- [`docs/phase0/journal-questions-juridiques.md`](docs/phase0/journal-questions-juridiques.md) -
  questions loi 09-08 ouvertes, bloquent la production, pas le developpement.
- [`docs/phase0/autorisation-etl-source-lecture.md`](docs/phase0/autorisation-etl-source-lecture.md) -
  **brouillon**, non envoye.
- [`docs/phase0/signalement-etat-source.md`](docs/phase0/signalement-etat-source.md) -
  **brouillon**, non envoye.

## Garde-fous

- `.gitleaks.toml` + `.githooks/pre-commit` : scan de secrets local (active
  par `git config core.hooksPath .githooks`).
- `.github/workflows/secret-scan.yml` : scan de secrets en CI.
- `.env.example` : noms de variables uniquement, aucune valeur.
