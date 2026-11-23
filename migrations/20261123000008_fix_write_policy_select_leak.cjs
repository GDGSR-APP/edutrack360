/*
 * Trouvaille empirique (Phase 2, experience vues) : owner_and_etl_write
 * (migration 7) etait FOR ALL, donc couvrait aussi SELECT. Une vue
 * DEFINER-style (sans security_invoker) evalue RLS comme son proprietaire
 * (edutrack_schema_owner) - la policy FOR ALL non restreinte s'appliquait
 * donc AUSSI en lecture via la vue, et neutralisait completement le filtre
 * par unite. Verifie par execution : une vue interrogee par app_role avec
 * un contexte unite A renvoyait les lignes des unites A ET B.
 *
 * Correction : owner_and_etl_write ne couvre plus que INSERT/UPDATE/DELETE.
 * Le SELECT reste exclusivement gouverne par unit_isolation_select, pour
 * TOUS les roles, y compris quand une vue s'execute comme le proprietaire.
 */

exports.up = (pgm) => {
  pgm.sql(`
    DROP POLICY owner_and_etl_write ON classes;
    DROP POLICY owner_and_etl_write ON periods;
    DROP POLICY owner_and_etl_write ON grades;
    DROP POLICY owner_and_etl_write ON student_averages;

    CREATE POLICY owner_and_etl_write ON classes
      FOR INSERT TO edutrack_schema_owner, etl_loader_role WITH CHECK (true);
    CREATE POLICY owner_and_etl_write_update ON classes
      FOR UPDATE TO edutrack_schema_owner, etl_loader_role USING (true) WITH CHECK (true);
    CREATE POLICY owner_and_etl_write_delete ON classes
      FOR DELETE TO edutrack_schema_owner, etl_loader_role USING (true);

    CREATE POLICY owner_and_etl_write ON periods
      FOR INSERT TO edutrack_schema_owner, etl_loader_role WITH CHECK (true);
    CREATE POLICY owner_and_etl_write_update ON periods
      FOR UPDATE TO edutrack_schema_owner, etl_loader_role USING (true) WITH CHECK (true);
    CREATE POLICY owner_and_etl_write_delete ON periods
      FOR DELETE TO edutrack_schema_owner, etl_loader_role USING (true);

    CREATE POLICY owner_and_etl_write ON grades
      FOR INSERT TO edutrack_schema_owner, etl_loader_role WITH CHECK (true);
    CREATE POLICY owner_and_etl_write_update ON grades
      FOR UPDATE TO edutrack_schema_owner, etl_loader_role USING (true) WITH CHECK (true);
    CREATE POLICY owner_and_etl_write_delete ON grades
      FOR DELETE TO edutrack_schema_owner, etl_loader_role USING (true);

    CREATE POLICY owner_and_etl_write ON student_averages
      FOR INSERT TO edutrack_schema_owner, etl_loader_role WITH CHECK (true);
    CREATE POLICY owner_and_etl_write_update ON student_averages
      FOR UPDATE TO edutrack_schema_owner, etl_loader_role USING (true) WITH CHECK (true);
    CREATE POLICY owner_and_etl_write_delete ON student_averages
      FOR DELETE TO edutrack_schema_owner, etl_loader_role USING (true);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY owner_and_etl_write_delete ON student_averages;
    DROP POLICY owner_and_etl_write_update ON student_averages;
    DROP POLICY owner_and_etl_write ON student_averages;

    DROP POLICY owner_and_etl_write_delete ON grades;
    DROP POLICY owner_and_etl_write_update ON grades;
    DROP POLICY owner_and_etl_write ON grades;

    DROP POLICY owner_and_etl_write_delete ON periods;
    DROP POLICY owner_and_etl_write_update ON periods;
    DROP POLICY owner_and_etl_write ON periods;

    DROP POLICY owner_and_etl_write_delete ON classes;
    DROP POLICY owner_and_etl_write_update ON classes;
    DROP POLICY owner_and_etl_write ON classes;

    CREATE POLICY owner_and_etl_write ON classes
      FOR ALL TO edutrack_schema_owner, etl_loader_role USING (true) WITH CHECK (true);
    CREATE POLICY owner_and_etl_write ON periods
      FOR ALL TO edutrack_schema_owner, etl_loader_role USING (true) WITH CHECK (true);
    CREATE POLICY owner_and_etl_write ON grades
      FOR ALL TO edutrack_schema_owner, etl_loader_role USING (true) WITH CHECK (true);
    CREATE POLICY owner_and_etl_write ON student_averages
      FOR ALL TO edutrack_schema_owner, etl_loader_role USING (true) WITH CHECK (true);
  `);
};
