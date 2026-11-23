/*
 * Preuve permanente de la trouvaille empirique Phase 2 (docs/phase2/notes-phase2.md) :
 * les vues de la couche d'acces (migration 9) sont DEFINER-style (pas
 * security_invoker), et doivent filtrer correctement par unite pour
 * app_role, qui n'a AUCUN grant sur les tables de base - seulement sur ces
 * vues. Ce test echouerait si security_invoker etait ajoute par erreur
 * (permission denied) ou si une future policy FOR ALL trop permissive
 * revenait court-circuiter le filtre (cf. migrations 7/8).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

let superuser;
let unitA, unitB, levelId;

beforeAll(async () => {
  superuser = new Client({ connectionString: process.env.TEST_SUPERUSER_URL });
  await superuser.connect();

  const units = await superuser.query(
    `INSERT INTO units (code, name) VALUES ('VA', 'Vue A'), ('VB', 'Vue B') RETURNING id, code`
  );
  unitA = units.rows.find((r) => r.code === "VA").id;
  unitB = units.rows.find((r) => r.code === "VB").id;

  const level = await superuser.query(
    `INSERT INTO levels (code, name) VALUES ('VL1', 'Vue Niveau 1') RETURNING id`
  );
  levelId = level.rows[0].id;

  await superuser.query(
    `INSERT INTO classes (unit_id, level_id, name) VALUES ($1, $3, 'Vue Classe A'), ($2, $3, 'Vue Classe B')`,
    [unitA, unitB, levelId]
  );
});

afterAll(async () => {
  await superuser.query(`DELETE FROM classes WHERE unit_id IN ($1, $2)`, [unitA, unitB]);
  await superuser.query(`DELETE FROM levels WHERE id = $1`, [levelId]);
  await superuser.query(`DELETE FROM units WHERE id IN ($1, $2)`, [unitA, unitB]);
  await superuser.end();
});

describe("Couche d'acces - vues DEFINER-style, app_role sans grant table", () => {
  it("app_role n'a aucun grant sur la table classes, seulement sur v_classes", async () => {
    const { rows } = await superuser.query(`
      SELECT table_name FROM information_schema.table_privileges
      WHERE grantee = 'app_role' AND table_name IN ('classes', 'v_classes')
    `);
    expect(rows.map((r) => r.table_name).sort()).toEqual(["v_classes"]);
  });

  it("v_classes filtre par unite pour app_role, contexte unite A seule", async () => {
    const appRole = new Client({ connectionString: process.env.APP_ROLE_DATABASE_URL });
    await appRole.connect();
    await appRole.query("BEGIN");
    await appRole.query(`SET LOCAL app.current_unit_ids = '${unitA}'`);
    const { rows } = await appRole.query(
      "SELECT unit_id FROM v_classes WHERE unit_id IN ($1, $2)",
      [unitA, unitB]
    );
    await appRole.query("COMMIT");
    await appRole.end();
    expect(rows).toHaveLength(1);
    expect(rows[0].unit_id).toBe(unitA);
  });

  it("v_classes renvoie 0 ligne pour app_role sans contexte pose", async () => {
    const appRole = new Client({ connectionString: process.env.APP_ROLE_DATABASE_URL });
    await appRole.connect();
    const { rows } = await appRole.query(
      "SELECT unit_id FROM v_classes WHERE unit_id IN ($1, $2)",
      [unitA, unitB]
    );
    await appRole.end();
    expect(rows).toEqual([]);
  });
});
