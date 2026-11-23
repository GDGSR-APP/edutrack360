/* Referentiels globaux, non sensibles, pas de RLS. */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE units (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text UNIQUE NOT NULL,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE levels (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text UNIQUE NOT NULL,
      name text NOT NULL
    );

    CREATE TABLE subjects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text UNIQUE NOT NULL,
      name text NOT NULL
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS subjects;
    DROP TABLE IF EXISTS levels;
    DROP TABLE IF EXISTS units;
  `);
};
