/*
 * Decision du directeur de projet (avant Phase 3) : fonction SECURITY
 * DEFINER etroite pour la resolution d'identite au premier login Google,
 * plutot qu'un role de connexion separe. app_role continue de n'avoir
 * AUCUN grant table direct (A1) - seulement EXECUTE sur cette fonction.
 *
 * Perimetre volontairement minimal : recherche par google_subject,
 * insertion si absent, mise a jour de email/display_name si present.
 * Ne touche JAMAIS user_unit_grants. Ne permet aucune lecture d'un autre
 * utilisateur par un chemin different de google_subject exact.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION find_or_create_user(
      p_google_subject text,
      p_email text,
      p_display_name text
    )
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    DECLARE
      v_id uuid;
    BEGIN
      SELECT id INTO v_id FROM users WHERE google_subject = p_google_subject;
      IF v_id IS NULL THEN
        INSERT INTO users (google_subject, email, display_name)
        VALUES (p_google_subject, p_email, p_display_name)
        RETURNING id INTO v_id;
      ELSE
        UPDATE users SET email = p_email, display_name = p_display_name WHERE id = v_id;
      END IF;
      RETURN v_id;
    END;
    $$;

    -- Verifie empiriquement (docs/phase3/notes-phase3.md) : edutrack_schema_owner
    -- n'a pas BYPASSRLS, donc FORCE ROW LEVEL SECURITY + self_only sur users
    -- bloque meme le proprietaire pour un utilisateur qui n'existe pas encore
    -- ("new row violates row-level security policy for table users"). D'ou
    -- un transfert de propriete vers auth_bootstrap_owner (NOLOGIN, BYPASSRLS,
    -- infra/bootstrap-roles.sql), dont c'est le seul usage.
    ALTER FUNCTION find_or_create_user(text, text, text) OWNER TO auth_bootstrap_owner;

    -- BYPASSRLS contourne les POLICIES, pas le controle de privilege de
    -- base sur la table - verifie empiriquement ("permission denied for
    -- table users" malgre BYPASSRLS, docs/phase3/notes-phase3.md).
    -- migration 6 a fait REVOKE ALL ... FROM PUBLIC : sans ce grant explicite,
    -- auth_bootstrap_owner n'a rien sur users, proprietaire de la fonction ou pas.
    GRANT SELECT, INSERT, UPDATE ON users TO auth_bootstrap_owner;

    REVOKE ALL ON FUNCTION find_or_create_user(text, text, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION find_or_create_user(text, text, text) TO app_role;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE SELECT, INSERT, UPDATE ON users FROM auth_bootstrap_owner;
    DROP FUNCTION IF EXISTS find_or_create_user(text, text, text);
  `);
};
