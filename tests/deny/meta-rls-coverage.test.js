/*
 * Meta-test : toute table ayant une colonne unit_id doit avoir RLS activee
 * ET forcee. C'est exactement le defaut mesure sur la base source (33
 * tables sans RLS, cf. docs/phase0/signalement-etat-source.md) - ce test
 * empeche qu'il se reproduise ici, y compris pour une table ajoutee plus
 * tard sans qu'on y pense.
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

describe("Meta - RLS forcee sur toute table unit_id", () => {
  it("n'a aucune table avec unit_id et RLS non forcee", async () => {
    const { rows } = await superuser.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'unit_id'
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
        AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)
    `);
    expect(rows).toEqual([]);
  });

  it("confirme les tables attendues avec unit_id + RLS forcee (4 unit-scopees + user_unit_grants + grant_audit_log, Phase 4)", async () => {
    const { rows } = await superuser.query(`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'unit_id'
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
        AND c.relrowsecurity = true AND c.relforcerowsecurity = true
      ORDER BY c.relname
    `);
    expect(rows.map((r) => r.relname)).toEqual([
      "classes",
      "grades",
      "grant_audit_log",
      "periods",
      "student_averages",
      "user_unit_grants",
    ]);
  });
});
