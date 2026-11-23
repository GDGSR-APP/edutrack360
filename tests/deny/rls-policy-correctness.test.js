/*
 * Correction des policies RLS, via test_rls_probe (SELECT accorde, mais
 * soumis a FORCE ROW LEVEL SECURITY - role de test uniquement, jamais
 * deploye). Fixture inseree par le superuser (qui contourne RLS), pour
 * avoir deux unites distinctes a isoler l'une de l'autre.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

let superuser;
let unitA, unitB, levelId, classA, classB;

beforeAll(async () => {
  superuser = new Client({ connectionString: process.env.TEST_SUPERUSER_URL });
  await superuser.connect();

  const units = await superuser.query(
    `INSERT INTO units (code, name) VALUES ('UA', 'Unite A'), ('UB', 'Unite B') RETURNING id, code`
  );
  unitA = units.rows.find((r) => r.code === "UA").id;
  unitB = units.rows.find((r) => r.code === "UB").id;

  const level = await superuser.query(
    `INSERT INTO levels (code, name) VALUES ('L1', 'Niveau 1') RETURNING id`
  );
  levelId = level.rows[0].id;

  const classes = await superuser.query(
    `INSERT INTO classes (unit_id, level_id, name) VALUES ($1, $3, 'Classe A'), ($2, $3, 'Classe B') RETURNING id, unit_id`,
    [unitA, unitB, levelId]
  );
  classA = classes.rows.find((r) => r.unit_id === unitA).id;
  classB = classes.rows.find((r) => r.unit_id === unitB).id;
});

afterAll(async () => {
  await superuser.query(`DELETE FROM classes WHERE unit_id IN ($1, $2)`, [unitA, unitB]);
  await superuser.query(`DELETE FROM levels WHERE id = $1`, [levelId]);
  await superuser.query(`DELETE FROM units WHERE id IN ($1, $2)`, [unitA, unitB]);
  await superuser.end();
});

async function queryAsProbe(unitIdsCsv) {
  const probe = new Client({ connectionString: process.env.TEST_RLS_PROBE_DATABASE_URL });
  await probe.connect();
  try {
    await probe.query("BEGIN");
    await probe.query(`SET LOCAL app.current_unit_ids = '${unitIdsCsv}'`);
    const { rows } = await probe.query("SELECT id, unit_id FROM classes ORDER BY name");
    await probe.query("COMMIT");
    return rows;
  } finally {
    await probe.end();
  }
}

describe("RLS - correction des policies via test_rls_probe", () => {
  it("contexte vide => 0 ligne, meme si des lignes existent pour d'autres unites", async () => {
    const rows = await queryAsProbe("");
    expect(rows).toEqual([]);
  });

  it("contexte unite A => seulement les lignes de l'unite A", async () => {
    const rows = await queryAsProbe(unitA);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(classA);
    expect(rows[0].unit_id).toBe(unitA);
  });

  it("contexte unite A+B => les deux, jamais une unite non listee", async () => {
    const rows = await queryAsProbe(`${unitA},${unitB}`);
    expect(rows.map((r) => r.id).sort()).toEqual([classA, classB].sort());
  });
});
