/*
 * users et user_unit_grants : isolation par IDENTITE, pas par unite - ce
 * sont les tables qui DEFINISSENT le perimetre, les filtrer par unite serait
 * circulaire. Un utilisateur ne voit que sa propre ligne / ses propres
 * grants.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      google_subject text UNIQUE NOT NULL,
      email text NOT NULL,
      display_name text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE users FORCE ROW LEVEL SECURITY;

    CREATE TABLE user_unit_grants (
      user_id uuid NOT NULL REFERENCES users(id),
      unit_id uuid NOT NULL REFERENCES units(id),
      granted_at timestamptz NOT NULL DEFAULT now(),
      granted_by uuid REFERENCES users(id),
      PRIMARY KEY (user_id, unit_id)
    );
    ALTER TABLE user_unit_grants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_unit_grants FORCE ROW LEVEL SECURITY;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS user_unit_grants;
    DROP TABLE IF EXISTS users;
  `);
};
