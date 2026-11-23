/*
 * support_signal_config : seuils PEDAGOGIQUES, pas une decision technique.
 * Table creee VIDE. Aucune valeur par defaut codee en dur (point 3). Le
 * calcul du signal (Phase 8) doit echouer explicitement ou afficher une
 * absence de signal si cette table est vide, jamais inventer une valeur.
 *
 * etl_load_runs : fraicheur (point 4). Une page affichant des donnees ETL
 * doit pouvoir afficher la date du dernier run reussi couvrant ces donnees.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE support_signal_config (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      level_id uuid REFERENCES levels(id),
      subject_id uuid REFERENCES subjects(id),
      period_id uuid REFERENCES periods(id),
      threshold_type text NOT NULL,
      threshold_value numeric NOT NULL,
      valid_from date NOT NULL,
      created_by uuid REFERENCES users(id),
      validated_by uuid REFERENCES users(id),
      validated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE etl_load_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      scope text NOT NULL,
      started_at timestamptz NOT NULL,
      finished_at timestamptz,
      status text NOT NULL,
      rows_loaded integer
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS etl_load_runs;
    DROP TABLE IF EXISTS support_signal_config;
  `);
};
