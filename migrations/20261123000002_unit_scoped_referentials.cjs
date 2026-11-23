/* classes et periods sont specifiques a une unite (une ecole) -> RLS forcee. */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE classes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      unit_id uuid NOT NULL REFERENCES units(id),
      level_id uuid NOT NULL REFERENCES levels(id),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE classes FORCE ROW LEVEL SECURITY;

    CREATE TABLE periods (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      unit_id uuid NOT NULL REFERENCES units(id),
      code text NOT NULL,
      label text NOT NULL,
      starts_on date,
      ends_on date,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE periods ENABLE ROW LEVEL SECURITY;
    ALTER TABLE periods FORCE ROW LEVEL SECURITY;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS periods;
    DROP TABLE IF EXISTS classes;
  `);
};
