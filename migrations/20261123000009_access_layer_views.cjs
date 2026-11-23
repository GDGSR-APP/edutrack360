/*
 * Couche d'acces (A1, Phase 2). CORRECTION PAR RAPPORT AU LIBELLE DU PLAN :
 * le plan demandait des vues "security_invoker". Verifie empiriquement
 * (docs/phase2/notes-phase2.md) : security_invoker force les tables de
 * base a etre verifiees avec les droits de l'APPELANT, donc app_role
 * devrait avoir un GRANT direct sur les tables - ce qui viole A1 et
 * echoue ("permission denied for table classes").
 *
 * Les vues ci-dessous sont DEFINER-style (comportement par defaut, sans
 * l'option security_invoker). Verifie empiriquement : app_role n'a besoin
 * que d'un GRANT SELECT sur la vue (jamais sur la table de base), et le
 * filtre RLS par unite continue a s'appliquer correctement - A CONDITION
 * que la policy de SELECT (unit_isolation_select) ne soit pas court-
 * circuitee par une policy FOR ALL trop permissive (voir migration 8,
 * trouvaille empirique : une policy FOR ALL scopee au proprietaire
 * s'appliquait aussi en lecture via la vue et neutralisait le filtre).
 *
 * app_role ne recoit JAMAIS de GRANT sur les tables de base, seulement sur
 * ces vues.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE VIEW v_classes AS
      SELECT id, unit_id, level_id, name FROM classes;

    CREATE VIEW v_periods AS
      SELECT id, unit_id, code, label, starts_on, ends_on FROM periods;

    CREATE VIEW v_grades AS
      SELECT id, student_code, unit_id, class_id, subject_id, period_id,
             grade_value, grade_scale, source_row_version, source_updated_at
      FROM grades;

    CREATE VIEW v_student_averages AS
      SELECT id, student_code, unit_id, class_id, subject_id, period_id,
             average_value, pass_threshold
      FROM student_averages;

    -- Referentiels globaux, non sensibles : exposes via vue aussi, par
    -- coherence avec A1 (app_role ne touche jamais une table de base).
    CREATE VIEW v_units AS SELECT id, code, name FROM units;
    CREATE VIEW v_levels AS SELECT id, code, name FROM levels;
    CREATE VIEW v_subjects AS SELECT id, code, name FROM subjects;

    -- Config du signal (point 3) : vide tant que non validee par le metier.
    CREATE VIEW v_support_signal_config AS
      SELECT id, level_id, subject_id, period_id, threshold_type,
             threshold_value, valid_from
      FROM support_signal_config
      WHERE validated_at IS NOT NULL;

    -- Fraicheur (point 4) : dernier run reussi par perimetre.
    CREATE VIEW v_latest_successful_etl_run AS
      SELECT scope, MAX(finished_at) AS last_successful_at
      FROM etl_load_runs
      WHERE status = 'success'
      GROUP BY scope;

    -- Identite/perimetre (A4) : chacun ne voit que sa propre ligne (deja
    -- impose par la policy self_only sur les tables elles-memes).
    CREATE VIEW v_my_profile AS
      SELECT id, email, display_name FROM users;

    CREATE VIEW v_my_unit_grants AS
      SELECT user_id, unit_id, granted_at FROM user_unit_grants;

    GRANT SELECT ON
      v_classes, v_periods, v_grades, v_student_averages,
      v_units, v_levels, v_subjects,
      v_support_signal_config, v_latest_successful_etl_run,
      v_my_profile, v_my_unit_grants
      TO app_role;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE SELECT ON
      v_classes, v_periods, v_grades, v_student_averages,
      v_units, v_levels, v_subjects,
      v_support_signal_config, v_latest_successful_etl_run,
      v_my_profile, v_my_unit_grants
      FROM app_role;

    DROP VIEW v_my_unit_grants;
    DROP VIEW v_my_profile;
    DROP VIEW v_latest_successful_etl_run;
    DROP VIEW v_support_signal_config;
    DROP VIEW v_subjects;
    DROP VIEW v_levels;
    DROP VIEW v_units;
    DROP VIEW v_student_averages;
    DROP VIEW v_grades;
    DROP VIEW v_periods;
    DROP VIEW v_classes;
  `);
};
