/*
 * Colonnes limitees a A5 : aucun nom, prenom, date de naissance, identifiant
 * national. student_code est une cle opaque (uuid), sa correspondance avec
 * l'identifiant national source vit hors de cette base (Phase 7, ETL) - ici
 * on ne fait que declarer le type de colonne, aucune donnee n'est chargee.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE grades (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      student_code uuid NOT NULL,
      unit_id uuid NOT NULL REFERENCES units(id),
      class_id uuid NOT NULL REFERENCES classes(id),
      subject_id uuid NOT NULL REFERENCES subjects(id),
      period_id uuid NOT NULL REFERENCES periods(id),
      grade_value numeric NOT NULL,
      grade_scale numeric NOT NULL,
      source_row_version text,
      source_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
    ALTER TABLE grades FORCE ROW LEVEL SECURITY;
    CREATE INDEX grades_unit_id_idx ON grades (unit_id);

    CREATE TABLE student_averages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      student_code uuid NOT NULL,
      unit_id uuid NOT NULL REFERENCES units(id),
      class_id uuid NOT NULL REFERENCES classes(id),
      subject_id uuid NOT NULL REFERENCES subjects(id),
      period_id uuid NOT NULL REFERENCES periods(id),
      average_value numeric NOT NULL,
      pass_threshold numeric,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE student_averages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE student_averages FORCE ROW LEVEL SECURITY;
    CREATE INDEX student_averages_unit_id_idx ON student_averages (unit_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS student_averages;
    DROP TABLE IF EXISTS grades;
  `);
};
