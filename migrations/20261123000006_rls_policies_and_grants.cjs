/*
 * A1 : aucun GRANT table pour app_role. Il n'apparait JAMAIS dans ce fichier
 * cote GRANT - c'est volontaire, pas un oubli.
 *
 * test_rls_probe recoit SELECT sur les 4 tables unit-scoped, UNIQUEMENT pour
 * verifier que les policies RLS filtrent correctement. Ce role n'est jamais
 * deploye en production.
 *
 * Contexte pose en transaction-locale par l'appelant via :
 *   SET LOCAL app.current_unit_ids = 'uuid1,uuid2,...';
 *   SET LOCAL app.current_user_id = 'uuid';
 * Jamais SET (session), toujours SET LOCAL (transaction) - fuite via pooling
 * sinon.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION app_current_unit_ids() RETURNS uuid[] AS $$
      SELECT CASE
        WHEN current_setting('app.current_unit_ids', true) IS NULL
          OR current_setting('app.current_unit_ids', true) = ''
        THEN ARRAY[]::uuid[]
        ELSE string_to_array(current_setting('app.current_unit_ids', true), ',')::uuid[]
      END;
    $$ LANGUAGE sql STABLE;

    CREATE FUNCTION app_current_user_id() RETURNS uuid AS $$
      SELECT CASE
        WHEN current_setting('app.current_user_id', true) IS NULL
          OR current_setting('app.current_user_id', true) = ''
        THEN NULL
        ELSE current_setting('app.current_user_id', true)::uuid
      END;
    $$ LANGUAGE sql STABLE;

    -- Refus par defaut : pas de contexte => tableau vide => ANY() ne matche rien.
    CREATE POLICY unit_isolation ON classes
      USING (unit_id = ANY (app_current_unit_ids()));
    CREATE POLICY unit_isolation ON periods
      USING (unit_id = ANY (app_current_unit_ids()));
    CREATE POLICY unit_isolation ON grades
      USING (unit_id = ANY (app_current_unit_ids()));
    CREATE POLICY unit_isolation ON student_averages
      USING (unit_id = ANY (app_current_unit_ids()));

    -- Isolation par identite, pas par unite (A4) : definit le perimetre lui-meme.
    CREATE POLICY self_only ON users
      USING (id = app_current_user_id());
    CREATE POLICY self_only ON user_unit_grants
      USING (user_id = app_current_user_id());

    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

    GRANT SELECT ON classes, periods, grades, student_averages TO test_rls_probe;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE SELECT ON classes, periods, grades, student_averages FROM test_rls_probe;
    DROP POLICY IF EXISTS self_only ON user_unit_grants;
    DROP POLICY IF EXISTS self_only ON users;
    DROP POLICY IF EXISTS unit_isolation ON student_averages;
    DROP POLICY IF EXISTS unit_isolation ON grades;
    DROP POLICY IF EXISTS unit_isolation ON periods;
    DROP POLICY IF EXISTS unit_isolation ON classes;
    DROP FUNCTION IF EXISTS app_current_user_id();
    DROP FUNCTION IF EXISTS app_current_unit_ids();
  `);
};
