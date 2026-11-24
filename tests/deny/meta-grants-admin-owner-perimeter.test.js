/*
 * Meme discipline que auth_bootstrap_owner (Phase 3/4) appliquee a
 * grants_admin_owner : detection depuis le catalogue systeme, pas une
 * liste ecrite a la main, fermeture par defaut.
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

const EXPECTED_OWNED_FUNCTIONS = new Set([
  "grant_unit_access",
  "revoke_unit_access",
  "list_user_unit_grants",
]);
const EXPECTED_TABLE_GRANTS = new Set([
  "user_unit_grants.SELECT",
  "user_unit_grants.INSERT",
  "user_unit_grants.DELETE",
  "grant_audit_log.SELECT",
  "grant_audit_log.INSERT",
]);
// Le proprietaire (grants_admin_owner) apparait aussi implicitement comme
// grantee EXECUTE sur ses propres fonctions - meme comportement deja
// observe pour find_or_create_user/auth_bootstrap_owner. Les deux
// grantees legitimes, rien d'autre (jamais app_role, jamais PUBLIC).
const LEGITIMATE_GRANTEES = new Set(["edutrack_schema_owner", "grants_admin_owner"]);
const EXPECTED_ROUTINE_GRANTS = new Set([
  "grant_unit_access.edutrack_schema_owner.EXECUTE",
  "revoke_unit_access.edutrack_schema_owner.EXECUTE",
  "list_user_unit_grants.edutrack_schema_owner.EXECUTE",
  "grant_unit_access.grants_admin_owner.EXECUTE",
  "revoke_unit_access.grants_admin_owner.EXECUTE",
  "list_user_unit_grants.grants_admin_owner.EXECUTE",
]);

describe("Perimetre de grants_admin_owner - jamais au-dela de l'administration des grants", () => {
  it("ne possede aucune table/vue/sequence/index", async () => {
    const { rows } = await superuser.query(`
      SELECT c.relname FROM pg_class c
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE r.rolname = 'grants_admin_owner'
    `);
    expect(rows).toEqual([]);
  });

  it("ne possede exactement que les 3 fonctions d'administration des grants", async () => {
    const { rows } = await superuser.query(`
      SELECT p.proname FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE r.rolname = 'grants_admin_owner'
    `);
    expect(new Set(rows.map((r) => r.proname))).toEqual(EXPECTED_OWNED_FUNCTIONS);
  });

  it("n'a recu exactement que SELECT/INSERT/DELETE sur user_unit_grants, rien d'autre table", async () => {
    const { rows } = await superuser.query(`
      SELECT table_name, privilege_type FROM information_schema.table_privileges
      WHERE grantee = 'grants_admin_owner'
    `);
    const actual = new Set(rows.map((r) => `${r.table_name}.${r.privilege_type}`));
    expect(actual).toEqual(EXPECTED_TABLE_GRANTS);
  });

  it("n'est membre d'aucun autre role", async () => {
    const { rows } = await superuser.query(`
      SELECT r.rolname FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles me ON me.oid = m.member
      WHERE me.rolname = 'grants_admin_owner'
    `);
    expect(rows).toEqual([]);
  });

  it("n'a aucun attribut de role dangereux au-dela de BYPASSRLS (la necessite connue et approuvee)", async () => {
    const { rows } = await superuser.query(`
      SELECT rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = 'grants_admin_owner'
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

  it("les 3 fonctions ne sont EXECUTE-ables QUE par edutrack_schema_owner (jamais app_role, jamais PUBLIC)", async () => {
    const { rows } = await superuser.query(`
      SELECT routine_name, grantee, privilege_type FROM information_schema.routine_privileges
      WHERE routine_name IN ('grant_unit_access', 'revoke_unit_access', 'list_user_unit_grants')
    `);
    const unexpectedGrantees = rows.filter((r) => !LEGITIMATE_GRANTEES.has(r.grantee));
    expect(unexpectedGrantees).toEqual([]);
    const actual = new Set(rows.map((r) => `${r.routine_name}.${r.grantee}.${r.privilege_type}`));
    expect(actual).toEqual(EXPECTED_ROUTINE_GRANTS);
  });
});
