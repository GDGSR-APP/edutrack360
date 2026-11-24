/*
 * Demande explicite du directeur de projet, en confirmant l'ADR 0002 :
 * chaque appel a grant_unit_access/revoke_unit_access doit laisser une
 * trace (qui, a qui, quelle unite, quand). Verifie par execution avant
 * cette migration (docs/phase4/notes-phase4.md) : ce n'etait PAS le cas -
 * grant_unit_access n'alimentait jamais la colonne granted_by (deja
 * presente depuis la migration 3, mais jamais utilisee), et
 * revoke_unit_access faisait un DELETE pur qui detruit toute trace de ce
 * qui a ete retire.
 *
 * grant_audit_log est un journal APPEND-ONLY (aucune fonction ne le
 * modifie ni ne le supprime) : une ligne par appel, jamais ecrasee.
 * performed_by_role capture le ROLE POSTGRES reel (toujours
 * edutrack_schema_owner en pratique aujourd'hui, mais enregistre sans
 * supposer que ca ne changera jamais). performed_by (optionnel) permet a
 * l'operateur de consigner SA PROPRE identite applicative s'il en a une -
 * limite honnete et documentee : rien n'oblige ni ne verifie qu'il la
 * fournisse, faute d'un systeme d'identite pour les operateurs humains
 * eux-memes (hors perimetre de ce projet).
 *
 * Les anciennes signatures a 2 parametres sont SUPPRIMEES (pas seulement
 * remplacees) : CREATE OR REPLACE avec une liste de parametres differente
 * cree une fonction surchargee EN PLUS de l'ancienne, pas a sa place -
 * l'ancienne serait restee appelable, contournant l'audit silencieusement.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE grant_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      action text NOT NULL CHECK (action IN ('grant', 'revoke')),
      user_id uuid NOT NULL REFERENCES users(id),
      unit_id uuid NOT NULL REFERENCES units(id),
      performed_by uuid REFERENCES users(id),
      performed_by_role text NOT NULL DEFAULT session_user,
      performed_at timestamptz NOT NULL DEFAULT now()
    );

    -- RLS forcee par defense en profondeur (meme si app_role n'a de
    -- toute facon aucun grant ici) : aucune policy permissive, defaut-deny
    -- pour tout role sans BYPASSRLS. grants_admin_owner a BYPASSRLS, donc
    -- non affecte ; edutrack_schema_owner ne touche jamais cette table
    -- directement (seulement via les fonctions). Trouve par le meta-test
    -- de Phase 1 (toute table avec unit_id doit forcer RLS) qui s'applique
    -- correctement meme a une table ajoutee en Phase 4.
    ALTER TABLE grant_audit_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE grant_audit_log FORCE ROW LEVEL SECURITY;

    GRANT SELECT, INSERT ON grant_audit_log TO grants_admin_owner;

    -- list_user_unit_grants ne retournait que (user_id, unit_id) - la
    -- seule facon pour l'operateur de relire granted_by/granted_at (self_only
    -- bloque le SELECT direct), donc sans cette extension la trace existe
    -- dans la table mais reste invisible a l'operateur qui l'a posee.
    DROP FUNCTION list_user_unit_grants(uuid, uuid);
    CREATE FUNCTION list_user_unit_grants(p_user_id uuid DEFAULT NULL, p_unit_id uuid DEFAULT NULL)
    RETURNS TABLE(user_id uuid, unit_id uuid, granted_by uuid, granted_at timestamptz)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
      SELECT g.user_id, g.unit_id, g.granted_by, g.granted_at
      FROM public.user_unit_grants g
      WHERE (p_user_id IS NULL OR g.user_id = p_user_id)
        AND (p_unit_id IS NULL OR g.unit_id = p_unit_id);
    $$;
    ALTER FUNCTION list_user_unit_grants(uuid, uuid) OWNER TO grants_admin_owner;
    REVOKE ALL ON FUNCTION list_user_unit_grants(uuid, uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION list_user_unit_grants(uuid, uuid) TO edutrack_schema_owner;

    DROP FUNCTION grant_unit_access(uuid, uuid);
    DROP FUNCTION revoke_unit_access(uuid, uuid);

    CREATE FUNCTION grant_unit_access(p_user_id uuid, p_unit_id uuid, p_performed_by uuid DEFAULT NULL)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
    BEGIN
      INSERT INTO public.user_unit_grants (user_id, unit_id, granted_by)
      VALUES (p_user_id, p_unit_id, p_performed_by)
      ON CONFLICT (user_id, unit_id) DO NOTHING;

      INSERT INTO public.grant_audit_log (action, user_id, unit_id, performed_by)
      VALUES ('grant', p_user_id, p_unit_id, p_performed_by);
    END;
    $$;

    CREATE FUNCTION revoke_unit_access(p_user_id uuid, p_unit_id uuid, p_performed_by uuid DEFAULT NULL)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
    BEGIN
      DELETE FROM public.user_unit_grants
      WHERE user_id = p_user_id AND unit_id = p_unit_id;

      INSERT INTO public.grant_audit_log (action, user_id, unit_id, performed_by)
      VALUES ('revoke', p_user_id, p_unit_id, p_performed_by);
    END;
    $$;

    ALTER FUNCTION grant_unit_access(uuid, uuid, uuid) OWNER TO grants_admin_owner;
    ALTER FUNCTION revoke_unit_access(uuid, uuid, uuid) OWNER TO grants_admin_owner;

    REVOKE ALL ON FUNCTION grant_unit_access(uuid, uuid, uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION revoke_unit_access(uuid, uuid, uuid) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION grant_unit_access(uuid, uuid, uuid) TO edutrack_schema_owner;
    GRANT EXECUTE ON FUNCTION revoke_unit_access(uuid, uuid, uuid) TO edutrack_schema_owner;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION revoke_unit_access(uuid, uuid, uuid);
    DROP FUNCTION grant_unit_access(uuid, uuid, uuid);

    DROP FUNCTION list_user_unit_grants(uuid, uuid);
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
    ALTER FUNCTION list_user_unit_grants(uuid, uuid) OWNER TO grants_admin_owner;
    REVOKE ALL ON FUNCTION list_user_unit_grants(uuid, uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION list_user_unit_grants(uuid, uuid) TO edutrack_schema_owner;

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

    ALTER FUNCTION grant_unit_access(uuid, uuid) OWNER TO grants_admin_owner;
    ALTER FUNCTION revoke_unit_access(uuid, uuid) OWNER TO grants_admin_owner;

    REVOKE ALL ON FUNCTION grant_unit_access(uuid, uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION revoke_unit_access(uuid, uuid) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION grant_unit_access(uuid, uuid) TO edutrack_schema_owner;
    GRANT EXECUTE ON FUNCTION revoke_unit_access(uuid, uuid) TO edutrack_schema_owner;

    REVOKE SELECT, INSERT ON grant_audit_log FROM grants_admin_owner;
    DROP TABLE grant_audit_log;
  `);
};
