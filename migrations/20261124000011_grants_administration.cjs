/*
 * Decision du directeur de projet (avant la suite de la Phase 4,
 * docs/phase4/notes-phase4.md) : A4 ("user_unit_grants administre a la
 * main") n'avait aucun chemin d'execution reel - edutrack_schema_owner
 * est bloque par FORCE ROW LEVEL SECURITY + self_only sur users ET
 * user_unit_grants, exactement comme find_or_create_user l'etait avant
 * l'ADR 0001. Meme remede : des fonctions SECURITY DEFINER etroites,
 * possedees par un role BYPASSRLS DEDIE (grants_admin_owner - PAS
 * auth_bootstrap_owner, dont le perimetre est deja garanti exact par un
 * meta-test permanent).
 *
 * EXECUTE accorde UNIQUEMENT a edutrack_schema_owner - jamais a
 * app_role. L'administration reste hors de l'application, conforme a
 * "a la main" : un operateur de confiance, connecte en tant que
 * edutrack_schema_owner, appelle ces fonctions - l'application ne peut
 * jamais le faire elle-meme.
 *
 * search_path = '' + qualification explicite public.* partout -
 * meme discipline que find_or_create_user (Phase 3), apres la
 * vulnerabilite de detournement par table temporaire trouvee sur cette
 * fonction-la.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION grant_unit_access(p_user_id uuid, p_unit_id uuid)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      INSERT INTO public.user_unit_grants (user_id, unit_id)
      VALUES (p_user_id, p_unit_id)
      ON CONFLICT (user_id, unit_id) DO NOTHING;
    $$;

    CREATE FUNCTION revoke_unit_access(p_user_id uuid, p_unit_id uuid)
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      DELETE FROM public.user_unit_grants
      WHERE user_id = p_user_id AND unit_id = p_unit_id;
    $$;

    -- Visibilite minimale pour l'operateur : sans elle, edutrack_schema_owner
    -- ne peut meme pas RELIRE l'etat courant des grants (self_only bloque
    -- aussi le SELECT). Ne retourne que des id - aucune jointure vers
    -- users/units, aucun besoin de grant supplementaire sur ces tables.
    CREATE FUNCTION list_user_unit_grants(p_user_id uuid DEFAULT NULL, p_unit_id uuid DEFAULT NULL)
    RETURNS TABLE(user_id uuid, unit_id uuid)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      SELECT g.user_id, g.unit_id
      FROM public.user_unit_grants g
      WHERE (p_user_id IS NULL OR g.user_id = p_user_id)
        AND (p_unit_id IS NULL OR g.unit_id = p_unit_id);
    $$;

    ALTER FUNCTION grant_unit_access(uuid, uuid) OWNER TO grants_admin_owner;
    ALTER FUNCTION revoke_unit_access(uuid, uuid) OWNER TO grants_admin_owner;
    ALTER FUNCTION list_user_unit_grants(uuid, uuid) OWNER TO grants_admin_owner;

    GRANT SELECT, INSERT, DELETE ON user_unit_grants TO grants_admin_owner;

    REVOKE ALL ON FUNCTION grant_unit_access(uuid, uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION revoke_unit_access(uuid, uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION list_user_unit_grants(uuid, uuid) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION grant_unit_access(uuid, uuid) TO edutrack_schema_owner;
    GRANT EXECUTE ON FUNCTION revoke_unit_access(uuid, uuid) TO edutrack_schema_owner;
    GRANT EXECUTE ON FUNCTION list_user_unit_grants(uuid, uuid) TO edutrack_schema_owner;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE SELECT, INSERT, DELETE ON user_unit_grants FROM grants_admin_owner;
    DROP FUNCTION IF EXISTS list_user_unit_grants(uuid, uuid);
    DROP FUNCTION IF EXISTS revoke_unit_access(uuid, uuid);
    DROP FUNCTION IF EXISTS grant_unit_access(uuid, uuid);
  `);
};
