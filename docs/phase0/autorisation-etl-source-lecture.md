# Demande d'autorisation - creation d'un role de lecture dedie sur la base source

**Statut : BROUILLON. Non envoye.** Ce document est redige par cette session
de travail a la demande du directeur de projet ; son envoi au responsable de
la base source est une decision et une action qui appartiennent au directeur
de projet, pas a cette session.

## Objet

Demande d'autorisation ecrite pour creer, sur la base de production Supabase
existante, un role Postgres dedie en lecture seule, utilise exclusivement par
le processus ETL d'EduTrack360.

## Ce qui est demande

- Creation d'un role `etl_source_reader_role` (nom indicatif, a adapter).
- Droits : `SELECT` uniquement, limite colonne par colonne a la liste figurant
  en annexe (identique a la section A5 du plan EduTrack360 : codes, unite,
  niveau, classe, matiere, periode, notes, moyennes, seuils - **aucun nom,
  prenom, date de naissance, ni identifiant national**).
- Explicitement exclu : tout droit d'ecriture (INSERT/UPDATE/DELETE/TRUNCATE),
  tout acces au role `service_role`, tout acces aux fonctions `SECURITY
  DEFINER` existantes.

## Pourquoi cette demande existe

Mesure du 23/11/2026 (lecture seule, aucune modification) : 609 droits de
table pour `anon`/`authenticated` sur le schema `public`, dont 348 en
ecriture ; 33 tables sans aucune RLS (notes, moyennes officielles, seuils de
reussite, referentiels eleves incluses) ; 14 fonctions `SECURITY DEFINER`
appartenant a un superutilisateur, dont 12 executables par `authenticated`.
Aucune de ces constatations n'est modifiee par cette demande : elle demande au
contraire un acces **plus etroit** que ce qui existe deja pour `anon`/
`authenticated`.

Aucune replique de la base source n'existe. Creer ce role est donc une
modification de la production, qui ne peut pas etre faite sans cette
autorisation ecrite, prealable a toute execution de l'ETL.

## Ce qui n'est PAS demande

- Aucune modification d'une table, d'une fonction ou d'un droit existant sur
  la base source.
- Aucun acces au service de metadonnees de la pile source (constat separe,
  voir le document de signalement de l'etat de la source).

## Annexe - colonnes demandees (A5)

`student_code` (ou equivalent source destine a alimenter une pseudonymisation
hors base applicative), `unit_id`, `level_id`, `class_id`, `subject_id`,
`period_id`, `grade_value`, `grade_scale`, `average_value`, `pass_threshold`,
plus les colonnes techniques necessaires au suivi incremental (date de
derniere modification, identifiant technique de ligne).

---

*Prochaine etape : revue et envoi par le directeur de projet. Cette session
n'envoie rien.*
