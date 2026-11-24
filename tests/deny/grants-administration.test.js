/*
 * Reponse a la trouvaille de Phase 4 (docs/phase4/notes-phase4.md) : A4
 * ("user_unit_grants administre a la main") n'avait aucun chemin
 * d'execution reel. grant_unit_access/revoke_unit_access/list_user_unit_grants
 * (migration 11) le fournissent, pour edutrack_schema_owner UNIQUEMENT -
 * jamais pour app_role. Ce fichier prouve les deux moities de cette
 * affirmation, par execution, avec le role REEL (pas le superutilisateur
 * de test).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

let superuser;
let schemaOwner;
let appRole;
let unitId, userId;

beforeAll(async () => {
  superuser = new Client({ connectionString: process.env.TEST_SUPERUSER_URL });
  await superuser.connect();
  schemaOwner = new Client({ connectionString: process.env.SCHEMA_OWNER_DATABASE_URL });
  await schemaOwner.connect();
  appRole = new Client({ connectionString: process.env.APP_ROLE_DATABASE_URL });
  await appRole.connect();

  const unit = await superuser.query(
    `INSERT INTO units (code, name) VALUES ('GATEST', 'Grants Admin Test') RETURNING id`
  );
  unitId = unit.rows[0].id;

  const user = await superuser.query(
    `INSERT INTO users (google_subject, email) VALUES ('grants-admin-test', 'grantsadmin@test.test') RETURNING id`
  );
  userId = user.rows[0].id;
});

afterAll(async () => {
  await superuser.query(`DELETE FROM user_unit_grants WHERE user_id = $1`, [userId]);
  await superuser.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await superuser.query(`DELETE FROM units WHERE id = $1`, [unitId]);
  await appRole.end();
  await schemaOwner.end();
  await superuser.end();
});

describe("grant_unit_access / revoke_unit_access / list_user_unit_grants - operateur reel (edutrack_schema_owner)", () => {
  it("edutrack_schema_owner (pas le superutilisateur) peut accorder, lister, puis retirer un acces", async () => {
    await schemaOwner.query(`SELECT grant_unit_access($1, $2)`, [userId, unitId]);

    const afterGrant = await schemaOwner.query(`SELECT * FROM list_user_unit_grants($1, NULL)`, [
      userId,
    ]);
    expect(afterGrant.rows).toEqual([{ user_id: userId, unit_id: unitId }]);

    await schemaOwner.query(`SELECT revoke_unit_access($1, $2)`, [userId, unitId]);

    const afterRevoke = await schemaOwner.query(`SELECT * FROM list_user_unit_grants($1, NULL)`, [
      userId,
    ]);
    expect(afterRevoke.rows).toEqual([]);
  });

  it("est idempotent : accorder deux fois le meme acces ne cree pas de doublon ni d'erreur", async () => {
    await schemaOwner.query(`SELECT grant_unit_access($1, $2)`, [userId, unitId]);
    await schemaOwner.query(`SELECT grant_unit_access($1, $2)`, [userId, unitId]);

    const rows = await schemaOwner.query(`SELECT * FROM list_user_unit_grants($1, $2)`, [
      userId,
      unitId,
    ]);
    expect(rows.rows).toHaveLength(1);

    await schemaOwner.query(`SELECT revoke_unit_access($1, $2)`, [userId, unitId]);
  });

  it("retirer un acces qui n'existe pas ne leve pas d'erreur (idempotent dans l'autre sens)", async () => {
    await expect(
      schemaOwner.query(`SELECT revoke_unit_access($1, $2)`, [userId, unitId])
    ).resolves.toBeDefined();
  });
});

describe("refus : app_role ne peut executer aucune des 3 fonctions d'administration", () => {
  it("grant_unit_access refuse a app_role", async () => {
    await expect(appRole.query(`SELECT grant_unit_access($1, $2)`, [userId, unitId])).rejects.toThrow(
      /permission denied for function grant_unit_access/
    );
  });

  it("revoke_unit_access refuse a app_role", async () => {
    await expect(appRole.query(`SELECT revoke_unit_access($1, $2)`, [userId, unitId])).rejects.toThrow(
      /permission denied for function revoke_unit_access/
    );
  });

  it("list_user_unit_grants refuse a app_role", async () => {
    await expect(appRole.query(`SELECT * FROM list_user_unit_grants($1, $2)`, [userId, unitId])).rejects.toThrow(
      /permission denied for function list_user_unit_grants/
    );
  });

  it("PUBLIC n'a EXECUTE sur aucune des 3 fonctions", async () => {
    const { rows } = await superuser.query(`
      SELECT routine_name FROM information_schema.routine_privileges
      WHERE grantee = 'PUBLIC'
        AND routine_name IN ('grant_unit_access', 'revoke_unit_access', 'list_user_unit_grants')
    `);
    expect(rows).toEqual([]);
  });
});
