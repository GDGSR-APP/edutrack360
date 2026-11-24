/*
 * Demande explicite du directeur de projet (avant Phase 4) : auth_bootstrap_owner
 * (BYPASSRLS, cree en Phase 3 pour contourner le probleme d'amorcage de
 * find_or_create_user - docs/phase3/notes-phase3.md) ne doit JAMAIS
 * acquerir un privilege ou une propriete au-dela de son perimetre exact.
 * Meme methode que le meta-test des vues (Phase 2) : detection depuis le
 * catalogue systeme, pas une liste ecrite a la main qui pourrait oublier
 * un objet ajoute plus tard sans qu'on y pense.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

let superuser;

beforeAll(async () => {
  superuser = new Client({ connectionString: process.env.TEST_SUPERUSER_URL });
  await superuser.connect();
});

afterAll(async () => {
  await superuser.end();
});

// Perimetre exact approuve (docs/phase3/notes-phase3.md, section 8i et
// l'ADR correspondant). Toute decouverte en dehors de ceci fait echouer
// le test - fermeture par defaut, comme pour les vues.
const EXPECTED_OWNED_FUNCTIONS = new Set(["find_or_create_user"]);
const EXPECTED_OWNED_RELATIONS = new Set([]); // aucune table/vue
const EXPECTED_TABLE_GRANTS = new Set(["users.SELECT", "users.INSERT", "users.UPDATE"]);
const EXPECTED_ROUTINE_GRANTS = new Set(["find_or_create_user.EXECUTE"]);
// Seul edutrack_schema_owner doit etre membre de auth_bootstrap_owner
// (infra/bootstrap-roles.sql) - c'est ce qui lui permet d'ALTER OWNER la
// fonction. Un AUTRE role rendu membre heriterait de BYPASSRLS - trouve
// manquant par la relecture de Phase 6 (le test precedent ne verifiait
// que ce dont auth_bootstrap_owner est membre, jamais qui est membre de
// lui - la direction inverse).
const EXPECTED_MEMBERS_OF_AUTH_BOOTSTRAP_OWNER = new Set(["edutrack_schema_owner"]);

describe("Perimetre de auth_bootstrap_owner - jamais au-dela de l'amorcage find_or_create_user", () => {
  it("ne possede aucune table/vue/sequence/index - uniquement des fonctions", async () => {
    const { rows } = await superuser.query(`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE r.rolname = 'auth_bootstrap_owner'
    `);
    expect(new Set(rows.map((r) => r.relname))).toEqual(EXPECTED_OWNED_RELATIONS);
  });

  it("ne possede exactement que la fonction find_or_create_user", async () => {
    const { rows } = await superuser.query(`
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE r.rolname = 'auth_bootstrap_owner'
    `);
    expect(new Set(rows.map((r) => r.proname))).toEqual(EXPECTED_OWNED_FUNCTIONS);
  });

  it("ne possede aucun schema", async () => {
    const { rows } = await superuser.query(`
      SELECT n.nspname
      FROM pg_namespace n
      JOIN pg_roles r ON r.oid = n.nspowner
      WHERE r.rolname = 'auth_bootstrap_owner'
    `);
    expect(rows).toEqual([]);
  });

  it("n'a recu exactement que SELECT/INSERT/UPDATE sur users, rien d'autre table", async () => {
    const { rows } = await superuser.query(`
      SELECT table_name, privilege_type
      FROM information_schema.table_privileges
      WHERE grantee = 'auth_bootstrap_owner'
    `);
    const actual = new Set(rows.map((r) => `${r.table_name}.${r.privilege_type}`));
    expect(actual).toEqual(EXPECTED_TABLE_GRANTS);
  });

  it("n'a recu exactement que EXECUTE sur find_or_create_user, rien d'autre fonction", async () => {
    const { rows } = await superuser.query(`
      SELECT routine_name, privilege_type
      FROM information_schema.routine_privileges
      WHERE grantee = 'auth_bootstrap_owner'
    `);
    const actual = new Set(rows.map((r) => `${r.routine_name}.${r.privilege_type}`));
    expect(actual).toEqual(EXPECTED_ROUTINE_GRANTS);
  });

  it("n'est membre d'aucun autre role (pas de privilege herite)", async () => {
    const { rows } = await superuser.query(`
      SELECT r.rolname AS member_of
      FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles me ON me.oid = m.member
      WHERE me.rolname = 'auth_bootstrap_owner'
    `);
    expect(rows).toEqual([]);
  });

  it("seul edutrack_schema_owner est membre de auth_bootstrap_owner (direction inverse, trouvee manquante par la relecture Phase 6)", async () => {
    const { rows } = await superuser.query(`
      SELECT me.rolname AS member
      FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles me ON me.oid = m.member
      WHERE r.rolname = 'auth_bootstrap_owner'
    `);
    expect(new Set(rows.map((r) => r.member))).toEqual(EXPECTED_MEMBERS_OF_AUTH_BOOTSTRAP_OWNER);
  });

  it("n'a aucun attribut de role dangereux au-dela de BYPASSRLS (qui est la necessite connue et approuvee)", async () => {
    const { rows } = await superuser.query(`
      SELECT rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = 'auth_bootstrap_owner'
    `);
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolcanlogin: false,
      rolreplication: false,
      rolbypassrls: true,
    });
  });
});
