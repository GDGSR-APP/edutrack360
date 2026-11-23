/*
 * Trouvaille empirique (Phase 2, en testant les vues) : les policies
 * unit_isolation de la migration 6 etaient non qualifiees (FOR ALL), donc
 * leur USING sert aussi de WITH CHECK implicite pour INSERT/UPDATE. Avec
 * FORCE ROW LEVEL SECURITY, meme edutrack_schema_owner (proprietaire) ne
 * peut pas inserer sans avoir pose app.current_unit_ids - et etl_loader_role
 * aurait le meme probleme en production, pour charger plusieurs unites dans
 * un meme run.
 *
 * Correction : les policies unit_isolation deviennent SELECT uniquement.
 * L'ecriture est gouvernee par le GRANT (app_role et test_rls_probe n'ont
 * et n'auront jamais de GRANT INSERT/UPDATE - A1), pas par une seconde
 * restriction RLS sur les roles qui ONT le droit d'ecrire.
 */

exports.up = (pgm) => {
  pgm.sql(`
    DROP POLICY unit_isolation ON classes;
    DROP POLICY unit_isolation ON periods;
    DROP POLICY unit_isolation ON grades;
    DROP POLICY unit_isolation ON student_averages;

    CREATE POLICY unit_isolation_select ON classes
      FOR SELECT USING (unit_id = ANY (app_current_unit_ids()));
    CREATE POLICY unit_isolation_select ON periods
      FOR SELECT USING (unit_id = ANY (app_current_unit_ids()));
    CREATE POLICY unit_isolation_select ON grades
      FOR SELECT USING (unit_id = ANY (app_current_unit_ids()));
    CREATE POLICY unit_isolation_select ON student_averages
      FOR SELECT USING (unit_id = ANY (app_current_unit_ids()));

    -- Ecriture : gouvernee par le GRANT, pas par une condition d'unite.
    -- Seuls edutrack_schema_owner (migrations/fixtures) et etl_loader_role
    -- (Phase 7) ont jamais un GRANT INSERT/UPDATE sur ces tables.
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

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY owner_and_etl_write ON student_averages;
    DROP POLICY owner_and_etl_write ON grades;
    DROP POLICY owner_and_etl_write ON periods;
    DROP POLICY owner_and_etl_write ON classes;

    DROP POLICY unit_isolation_select ON student_averages;
    DROP POLICY unit_isolation_select ON grades;
    DROP POLICY unit_isolation_select ON periods;
    DROP POLICY unit_isolation_select ON classes;

    CREATE POLICY unit_isolation ON classes
      USING (unit_id = ANY (app_current_unit_ids()));
    CREATE POLICY unit_isolation ON periods
      USING (unit_id = ANY (app_current_unit_ids()));
    CREATE POLICY unit_isolation ON grades
      USING (unit_id = ANY (app_current_unit_ids()));
    CREATE POLICY unit_isolation ON student_averages
      USING (unit_id = ANY (app_current_unit_ids()));
  `);
};
