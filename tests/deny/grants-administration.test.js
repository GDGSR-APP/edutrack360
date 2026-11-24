/*
 * Reponse a la trouvaille de Phase 4 (docs/phase4/notes-phase4.md) : A4
 * ("user_unit_grants administre a la main") n'avait aucun chemin
 * d'execution reel. grant_unit_access/revoke_unit_access/list_user_unit_grants
 * (migrations 11-12) le fournissent, pour edutrack_schema_owner
 * UNIQUEMENT - jamais pour app_role. Ce fichier prouve, par execution et
 * avec le role REEL (pas le superutilisateur de test) :
 *   1. que edutrack_schema_owner peut administrer les grants,
 *   2. que app_role ne peut executer aucune des 3 fonctions,
 *   3. que chaque appel laisse une trace exploitable (directeur de
 *      projet, confirmation ADR 0002, point 1) : qui, a qui, quelle
 *      unite, quand - a la fois sur la ligne active (granted_by/granted_at)
 *      et dans un journal append-only qui survit meme au retrait
 *      (grant_audit_log, puisqu'un DELETE sur user_unit_grants ne
 *      laisserait sinon aucune trace de ce qui a ete retire).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

let superuser;
let schemaOwner;
let appRole;
let unitId, userId, performedById;

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

  const users = await superuser.query(
    `INSERT INTO users (google_subject, email) VALUES
       ('grants-admin-test', 'grantsadmin@test.test'),
       ('grants-admin-operator', 'operator@test.test')
     RETURNING id, google_subject`
  );
  userId = users.rows.find((r) => r.google_subject === "grants-admin-test").id;
  performedById = users.rows.find((r) => r.google_subject === "grants-admin-operator").id;
});

afterAll(async () => {
  await superuser.query(`DELETE FROM grant_audit_log WHERE user_id = $1`, [userId]);
  await superuser.query(`DELETE FROM user_unit_grants WHERE user_id = $1`, [userId]);
  await superuser.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userId, performedById]);
  await superuser.query(`DELETE FROM units WHERE id = $1`, [unitId]);
  await appRole.end();
  await schemaOwner.end();
  await superuser.end();
});

describe("grant_unit_access / revoke_unit_access / list_user_unit_grants - operateur reel (edutrack_schema_owner)", () => {
  it("edutrack_schema_owner (pas le superutilisateur) peut accorder, lister, puis retirer un acces", async () => {
    await schemaOwner.query(`SELECT grant_unit_access($1, $2, $3)`, [userId, unitId, performedById]);

    const afterGrant = await schemaOwner.query(`SELECT user_id, unit_id FROM list_user_unit_grants($1, NULL)`, [
      userId,
    ]);
    expect(afterGrant.rows).toEqual([{ user_id: userId, unit_id: unitId }]);

    await schemaOwner.query(`SELECT revoke_unit_access($1, $2, $3)`, [userId, unitId, performedById]);

    const afterRevoke = await schemaOwner.query(`SELECT * FROM list_user_unit_grants($1, NULL)`, [
      userId,
    ]);
    expect(afterRevoke.rows).toEqual([]);
  });

  it("est idempotent : accorder deux fois le meme acces ne cree pas de doublon ni d'erreur", async () => {
    await schemaOwner.query(`SELECT grant_unit_access($1, $2, $3)`, [userId, unitId, performedById]);
    await schemaOwner.query(`SELECT grant_unit_access($1, $2, $3)`, [userId, unitId, performedById]);

    const rows = await schemaOwner.query(`SELECT * FROM list_user_unit_grants($1, $2)`, [
      userId,
      unitId,
    ]);
    expect(rows.rows).toHaveLength(1);

    await schemaOwner.query(`SELECT revoke_unit_access($1, $2, $3)`, [userId, unitId, performedById]);
  });

  it("retirer un acces qui n'existe pas ne leve pas d'erreur (idempotent dans l'autre sens)", async () => {
    await expect(
      schemaOwner.query(`SELECT revoke_unit_access($1, $2, $3)`, [userId, unitId, performedById])
    ).resolves.toBeDefined();
  });

  it("appeler avec seulement 2 arguments reste possible (p_performed_by par defaut = NULL) - une SEULE fonction existe, pas un ancien surcharge vulnerable", async () => {
    // DROP FUNCTION grant_unit_access(uuid, uuid) supprime bien l'ancienne
    // signature exacte - mais Postgres resout un appel a 2 arguments contre
    // la fonction a 3 parametres (le 3e ayant un DEFAULT), ce qui n'est PAS
    // une faille : c'est la MEME fonction, auditee de la meme maniere,
    // avec performed_by simplement NULL. Verifie ici plutot que suppose.
    await schemaOwner.query(`SELECT grant_unit_access($1, $2)`, [userId, unitId]);

    const { rows } = await superuser.query(
      `SELECT performed_by FROM grant_audit_log
       WHERE user_id = $1 AND unit_id = $2 AND action = 'grant'
       ORDER BY performed_at DESC LIMIT 1`,
      [userId, unitId]
    );
    expect(rows[0].performed_by).toBeNull();

    await schemaOwner.query(`SELECT revoke_unit_access($1, $2)`, [userId, unitId]);
  });
});

describe("tracabilite (demande explicite du directeur de projet, confirmation ADR 0002) : qui, a qui, quelle unite, quand", () => {
  beforeAll(async () => {
    // Depart propre : les describe() precedents peuvent laisser une ligne
    // active dans user_unit_grants - ON CONFLICT DO NOTHING conserverait
    // alors son granted_by d'origine au lieu de celui pose ici.
    await schemaOwner.query(`SELECT revoke_unit_access($1, $2, $3)`, [userId, unitId, performedById]);
  });

  afterAll(async () => {
    await schemaOwner.query(`SELECT revoke_unit_access($1, $2, $3)`, [userId, unitId, performedById]);
  });

  it("grant_unit_access renseigne granted_by/granted_at sur la ligne active, visible via list_user_unit_grants", async () => {
    await schemaOwner.query(`SELECT grant_unit_access($1, $2, $3)`, [userId, unitId, performedById]);

    const { rows } = await schemaOwner.query(`SELECT * FROM list_user_unit_grants($1, $2)`, [
      userId,
      unitId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].granted_by).toBe(performedById);
    expect(rows[0].granted_at).toBeInstanceOf(Date);
  });

  it("grant_audit_log consigne l'octroi : action, qui, a qui, quelle unite, quand", async () => {
    const { rows } = await superuser.query(
      `SELECT action, user_id, unit_id, performed_by, performed_by_role, performed_at
       FROM grant_audit_log WHERE user_id = $1 AND unit_id = $2 AND action = 'grant'
       ORDER BY performed_at DESC LIMIT 1`,
      [userId, unitId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "grant",
      user_id: userId,
      unit_id: unitId,
      performed_by: performedById,
      performed_by_role: "edutrack_schema_owner",
    });
    expect(rows[0].performed_at).toBeInstanceOf(Date);
  });

  it("grant_audit_log consigne le retrait MEME APRES que la ligne active a disparu - le DELETE seul ne laissait aucune trace avant cette migration", async () => {
    await schemaOwner.query(`SELECT revoke_unit_access($1, $2, $3)`, [userId, unitId, performedById]);

    const activeRows = await schemaOwner.query(`SELECT * FROM list_user_unit_grants($1, $2)`, [
      userId,
      unitId,
    ]);
    expect(activeRows.rows).toEqual([]);

    const { rows } = await superuser.query(
      `SELECT action, user_id, unit_id, performed_by, performed_by_role
       FROM grant_audit_log WHERE user_id = $1 AND unit_id = $2 AND action = 'revoke'
       ORDER BY performed_at DESC LIMIT 1`,
      [userId, unitId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "revoke",
      user_id: userId,
      unit_id: unitId,
      performed_by: performedById,
      performed_by_role: "edutrack_schema_owner",
    });

    // Reaccorde pour laisser l'etat coherent pour le reste de la suite (le
    // afterAll de cette description retire a nouveau, idempotent).
    await schemaOwner.query(`SELECT grant_unit_access($1, $2, $3)`, [userId, unitId, performedById]);
  });

  it("performed_by est optionnel (NULL accepte) mais performed_by_role est TOUJOURS renseigne, meme sans identite applicative connue", async () => {
    await schemaOwner.query(`SELECT revoke_unit_access($1, $2, NULL)`, [userId, unitId]);

    const { rows } = await superuser.query(
      `SELECT performed_by, performed_by_role FROM grant_audit_log
       WHERE user_id = $1 AND unit_id = $2 AND action = 'revoke'
       ORDER BY performed_at DESC LIMIT 1`,
      [userId, unitId]
    );
    expect(rows[0].performed_by).toBeNull();
    expect(rows[0].performed_by_role).toBe("edutrack_schema_owner");

    await schemaOwner.query(`SELECT grant_unit_access($1, $2, $3)`, [userId, unitId, performedById]);
  });
});

describe("refus : app_role ne peut executer aucune des 3 fonctions d'administration", () => {
  it("grant_unit_access refuse a app_role", async () => {
    await expect(
      appRole.query(`SELECT grant_unit_access($1, $2, $3)`, [userId, unitId, performedById])
    ).rejects.toThrow(/permission denied for function grant_unit_access/);
  });

  it("revoke_unit_access refuse a app_role", async () => {
    await expect(
      appRole.query(`SELECT revoke_unit_access($1, $2, $3)`, [userId, unitId, performedById])
    ).rejects.toThrow(/permission denied for function revoke_unit_access/);
  });

  it("list_user_unit_grants refuse a app_role", async () => {
    await expect(
      appRole.query(`SELECT * FROM list_user_unit_grants($1, $2)`, [userId, unitId])
    ).rejects.toThrow(/permission denied for function list_user_unit_grants/);
  });

  it("app_role n'a non plus aucun acces direct a grant_audit_log", async () => {
    await expect(appRole.query(`SELECT * FROM grant_audit_log LIMIT 1`)).rejects.toThrow(
      /permission denied for table grant_audit_log/
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
