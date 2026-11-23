-- Bootstrap des roles Postgres pour EduTrack360.
-- A executer UNE FOIS, par un superutilisateur (ou un role avec CREATEROLE),
-- separement du pipeline de migrations node-pg-migrate (qui tourne sous
-- edutrack_schema_owner et n'a pas CREATEROLE).
-- Idempotent : peut etre rejoue sans erreur si les roles existent deja.
--
-- Mots de passe : places via \set en ligne de commande (psql -v) ou par un
-- outil de gestion de secrets - JAMAIS en clair dans ce fichier, qui est
-- versionne.
--
-- Note : la substitution de variables psql (:'var') ne traverse PAS un bloc
-- PL/pgSQL entre $$ ... $$ (observe a l'execution). L'idempotence est donc
-- geree ici par les meta-commandes psql \gset / \if, pas par un DO $$ bloc.

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edutrack_schema_owner') AS exists \gset
\if :exists
  \echo 'edutrack_schema_owner existe deja, ignore.'
\else
  CREATE ROLE edutrack_schema_owner LOGIN PASSWORD :'schema_owner_password';
\endif

-- A1 : app_role ne recoit et ne recevra jamais de GRANT table direct.
-- Uniquement EXECUTE sur les fonctions/vues security_invoker (Phase 2).
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') AS exists \gset
\if :exists
  \echo 'app_role existe deja, ignore.'
\else
  CREATE ROLE app_role LOGIN PASSWORD :'app_role_password';
\endif

-- Ecrit dans la base applicative via des fonctions de chargement dediees
-- (Phase 7), jamais de GRANT table direct non plus.
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'etl_loader_role') AS exists \gset
\if :exists
  \echo 'etl_loader_role existe deja, ignore.'
\else
  CREATE ROLE etl_loader_role LOGIN PASSWORD :'etl_loader_role_password';
\endif

-- Role de TEST UNIQUEMENT. Jamais deploye en production, jamais dans
-- .env.example. Sert a valider que les policies RLS filtrent bien par
-- unite, independamment de la verification A1 (zero grant) sur app_role.
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_rls_probe') AS exists \gset
\if :exists
  \echo 'test_rls_probe existe deja, ignore.'
\else
  CREATE ROLE test_rls_probe LOGIN PASSWORD :'test_rls_probe_password';
\endif

-- etl_source_reader_role n'est PAS cree ici : il vit sur la base SOURCE,
-- pas sur la base applicative, et seulement apres l'autorisation ecrite
-- (Phase 0, porte bloquante). Voir docs/phase0/autorisation-etl-source-lecture.md.
