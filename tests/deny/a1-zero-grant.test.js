/*
 * A1 : app_role ne doit avoir AUCUN grant table direct. Ce test echoue si un
 * grant apparait un jour - c'est la preuve qu'une regression serait
 * detectee, pas une affirmation sur papier.
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

describe("A1 - app_role sans aucun grant table", () => {
  it("n'a aucun privilege sur aucune TABLE DE BASE du schema public (les vues de la couche d'acces, Phase 2, sont attendues et exclues ici)", async () => {
    const { rows } = await superuser.query(`
      SELECT tp.table_name, tp.privilege_type
      FROM information_schema.table_privileges tp
      JOIN pg_class c ON c.relname = tp.table_name AND c.relnamespace = 'public'::regnamespace
      WHERE tp.grantee = 'app_role' AND tp.table_schema = 'public' AND c.relkind = 'r'
    `);
    expect(rows).toEqual([]);
  });

  it("echoue avec une erreur de permission, pas une liste vide, en SELECT direct", async () => {
    const appRole = new Client({ connectionString: process.env.APP_ROLE_DATABASE_URL });
    await appRole.connect();
    await expect(appRole.query("SELECT * FROM grades")).rejects.toThrow(/permission denied/i);
    await appRole.end();
  });
});
