/*
 * L'invariant central de la Phase 3, demande explicitement comme un test
 * et non un commentaire : un compte Google Workspace valide, sans ligne
 * dans user_unit_grants, ne voit AUCUNE donnee - meme si des donnees
 * existent reellement dans plusieurs unites. Chaine complete, bout en
 * bout : jeton valide (faux IdP reel) -> find_or_create_user -> couche
 * d'acces (v_grades via withAuthenticatedContext). Bras de controle :
 * apres l'ajout d'un seul grant, le meme utilisateur voit exactement et
 * seulement les donnees de cette unite - sans quoi "0 ligne" prouverait
 * seulement une fixture cassee, pas une isolation reelle.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { randomBytes } from "crypto";
import * as client from "openid-client";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

import { createGoogleOidcConfig, verifyGoogleCallback } from "../../src/auth/google-oidc.ts";
import { findOrCreateUser } from "../../src/data-access/users.ts";
import { getGradesForUser } from "../../src/data-access/grades.ts";
import { withAuthenticatedContext } from "../../src/data-access/db.ts";
import { startFakeGoogleIdp } from "./fake-google-idp.js";

const ALLOWED_DOMAIN = "ecoles-test.ma";
const CLIENT_ID = `test-client-${randomBytes(8).toString("hex")}`;
const CLIENT_SECRET = randomBytes(32).toString("hex");
const REDIRECT_URI = "http://localhost/callback";

let idp;
let oidcConfig;
let superuser;
let unitA, unitB, levelId, subjectId, classA, classB, periodA, periodB, gradeA, gradeB, averageA, averageB;
let resolvedUserId;

beforeAll(async () => {
  idp = await startFakeGoogleIdp();
  oidcConfig = await createGoogleOidcConfig({
    issuer: idp.issuerUrl,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    allowInsecureDiscoveryForTestsOnly: true,
  });

  superuser = new Client({ connectionString: process.env.TEST_SUPERUSER_URL });
  await superuser.connect();

  const units = await superuser.query(
    `INSERT INTO units (code, name) VALUES ('IA', 'Invariant A'), ('IB', 'Invariant B') RETURNING id, code`
  );
  unitA = units.rows.find((r) => r.code === "IA").id;
  unitB = units.rows.find((r) => r.code === "IB").id;

  const level = await superuser.query(
    `INSERT INTO levels (code, name) VALUES ('IL1', 'Invariant Niveau 1') RETURNING id`
  );
  levelId = level.rows[0].id;

  const subject = await superuser.query(
    `INSERT INTO subjects (code, name) VALUES ('IS1', 'Invariant Matiere 1') RETURNING id`
  );
  subjectId = subject.rows[0].id;

  const classes = await superuser.query(
    `INSERT INTO classes (unit_id, level_id, name) VALUES ($1, $3, 'Invariant Classe A'), ($2, $3, 'Invariant Classe B') RETURNING id, unit_id`,
    [unitA, unitB, levelId]
  );
  classA = classes.rows.find((r) => r.unit_id === unitA).id;
  classB = classes.rows.find((r) => r.unit_id === unitB).id;

  const periods = await superuser.query(
    `INSERT INTO periods (unit_id, code, label) VALUES ($1, 'IP', 'Invariant Periode A'), ($2, 'IP', 'Invariant Periode B') RETURNING id, unit_id`,
    [unitA, unitB]
  );
  periodA = periods.rows.find((r) => r.unit_id === unitA).id;
  periodB = periods.rows.find((r) => r.unit_id === unitB).id;

  const grades = await superuser.query(
    `INSERT INTO grades (student_code, unit_id, class_id, subject_id, period_id, grade_value, grade_scale)
     VALUES (gen_random_uuid(), $1, $3, $5, $6, 16, 20),
            (gen_random_uuid(), $2, $4, $5, $7, 9, 20)
     RETURNING id, unit_id`,
    [unitA, unitB, classA, classB, subjectId, periodA, periodB]
  );
  gradeA = grades.rows.find((r) => r.unit_id === unitA).id;
  gradeB = grades.rows.find((r) => r.unit_id === unitB).id;

  const averages = await superuser.query(
    `INSERT INTO student_averages (student_code, unit_id, class_id, subject_id, period_id, average_value)
     VALUES (gen_random_uuid(), $1, $3, $5, $6, 13),
            (gen_random_uuid(), $2, $4, $5, $7, 8)
     RETURNING id, unit_id`,
    [unitA, unitB, classA, classB, subjectId, periodA, periodB]
  );
  averageA = averages.rows.find((r) => r.unit_id === unitA).id;
  averageB = averages.rows.find((r) => r.unit_id === unitB).id;
});

afterAll(async () => {
  if (resolvedUserId) {
    await superuser.query(`DELETE FROM user_unit_grants WHERE user_id = $1`, [resolvedUserId]);
    await superuser.query(`DELETE FROM users WHERE id = $1`, [resolvedUserId]);
  }
  await superuser.query(`DELETE FROM student_averages WHERE id IN ($1, $2)`, [averageA, averageB]);
  await superuser.query(`DELETE FROM grades WHERE id IN ($1, $2)`, [gradeA, gradeB]);
  await superuser.query(`DELETE FROM periods WHERE id IN ($1, $2)`, [periodA, periodB]);
  await superuser.query(`DELETE FROM classes WHERE id IN ($1, $2)`, [classA, classB]);
  await superuser.query(`DELETE FROM subjects WHERE id = $1`, [subjectId]);
  await superuser.query(`DELETE FROM levels WHERE id = $1`, [levelId]);
  await superuser.query(`DELETE FROM units WHERE id IN ($1, $2)`, [unitA, unitB]);
  await superuser.end();
  await idp.close();
});

async function loginAsNewUser() {
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const now = Math.floor(Date.now() / 1000);

  await idp.setNextIdToken({
    iss: idp.issuerUrl.origin,
    aud: CLIENT_ID,
    sub: "invariant-test-subject",
    iat: now,
    exp: now + 3600,
    nonce,
    hd: ALLOWED_DOMAIN,
    email: "invariant@ecoles-test.ma",
    email_verified: true,
    name: "Invariant Test",
  });

  const currentUrl = new URL(REDIRECT_URI);
  currentUrl.searchParams.set("code", "fake-code");
  currentUrl.searchParams.set("state", state);

  const identity = await verifyGoogleCallback(
    oidcConfig,
    currentUrl,
    { codeVerifier, expectedState: state, expectedNonce: nonce },
    ALLOWED_DOMAIN
  );

  return findOrCreateUser(identity.googleSubject, identity.email, identity.displayName);
}

describe("Invariant central : compte valide sans grant => aucune donnee", () => {
  it("un compte Google Workspace valide, jamais vu, sans ligne dans user_unit_grants, ne voit aucune note - alors que des notes existent reellement dans 2 unites", async () => {
    resolvedUserId = await loginAsNewUser();
    expect(resolvedUserId).toBeTruthy();

    const grades = await getGradesForUser(resolvedUserId);
    expect(grades).toEqual([]);
  });

  it("bras de controle : apres l'ajout d'un seul grant (unite A), le meme utilisateur voit exactement et seulement les notes de l'unite A", async () => {
    await superuser.query(`INSERT INTO user_unit_grants (user_id, unit_id) VALUES ($1, $2)`, [
      resolvedUserId,
      unitA,
    ]);

    const grades = await getGradesForUser(resolvedUserId);
    expect(grades.map((g) => g.id)).toEqual([gradeA]);
    expect(grades.map((g) => g.id)).not.toContain(gradeB);
  });

  /*
   * L'affirmation "aucune donnee" ne portait jusqu'ici que sur v_grades.
   * Etendu aux 3 autres vues unit-scoped (v_classes, v_periods,
   * v_student_averages) dans les deux bras - sans quoi "0 ligne" ne
   * prouvait l'isolation que pour une seule vue parmi quatre.
   */
  it("etendu : v_classes, v_periods, v_student_averages suivent le meme invariant (0 ligne sans grant, puis seulement unite A)", async () => {
    // Retrait du grant precedent via le superuser (hors perimetre teste -
    // app_role n'a de toute facon aucun grant table sur user_unit_grants, A1).
    await superuser.query(`DELETE FROM user_unit_grants WHERE user_id = $1`, [resolvedUserId]);

    const zeroGrant = await withAuthenticatedContext(resolvedUserId, async (c) => {
      const classes = await c.query(`SELECT id FROM v_classes`);
      const periods = await c.query(`SELECT id FROM v_periods`);
      const averages = await c.query(`SELECT id FROM v_student_averages`);
      return { classes: classes.rows, periods: periods.rows, averages: averages.rows };
    });
    expect(zeroGrant.classes).toEqual([]);
    expect(zeroGrant.periods).toEqual([]);
    expect(zeroGrant.averages).toEqual([]);

    await superuser.query(`INSERT INTO user_unit_grants (user_id, unit_id) VALUES ($1, $2)`, [
      resolvedUserId,
      unitA,
    ]);

    const withGrant = await withAuthenticatedContext(resolvedUserId, async (c) => {
      const classes = await c.query(`SELECT id FROM v_classes`);
      const periods = await c.query(`SELECT id FROM v_periods`);
      const averages = await c.query(`SELECT id FROM v_student_averages`);
      return { classes: classes.rows, periods: periods.rows, averages: averages.rows };
    });
    expect(withGrant.classes.map((r) => r.id)).toEqual([classA]);
    expect(withGrant.periods.map((r) => r.id)).toEqual([periodA]);
    expect(withGrant.averages.map((r) => r.id)).toEqual([averageA]);
  });

  /*
   * Tranche par le directeur de projet (reponse au rapport de Phase 3) :
   * acceptable, et c'est la bonne conception - noms d'ecoles, niveaux et
   * matieres sont publics. Ce test fige ce comportement par execution.
   * Ce qui doit rester strictement ferme (donnees d'eleves, effectifs,
   * toute donnee nominative) est verifie separement ci-dessous, par
   * decouverte dynamique plutot que par une liste de tables ecrite a la
   * main (meme discipline que le meta-test des vues).
   */
  it("decision actee : un utilisateur sans aucun grant voit tout de meme les referentiels globaux (noms d'unites/niveaux/matieres)", async () => {
    await superuser.query(`DELETE FROM user_unit_grants WHERE user_id = $1`, [resolvedUserId]);

    const visible = await withAuthenticatedContext(resolvedUserId, async (c) => {
      const units = await c.query(`SELECT id FROM v_units WHERE id IN ($1, $2)`, [unitA, unitB]);
      return units.rows;
    });
    // Documente le comportement reel : les deux unites sont visibles meme
    // sans grant. Si ce n'est pas le comportement souhaite, c'est une
    // decision produit a prendre, pas un bug de cette fonction.
    expect(visible.map((r) => r.id).sort()).toEqual([unitA, unitB].sort());
  });

  /*
   * Demande explicite du directeur de projet, en reponse directe au point
   * precedent : les tables/vues contenant des donnees d'eleves doivent
   * rester strictement fermees pour un utilisateur sans grant, meme en
   * agregat (aucun effectif, meme un simple COUNT). Decouverte dynamique
   * des tables "donnees d'eleves" via la colonne student_code (marqueur
   * A5 de donnee individualisee), pas une liste ecrite a la main - une
   * future table avec cette colonne est couverte automatiquement.
   */
  it("fermeture stricte : aucune ligne ET aucun agregat (meme un COUNT ou un effectif par classe) sur les donnees d'eleves, pour un utilisateur sans grant", async () => {
    await superuser.query(`DELETE FROM user_unit_grants WHERE user_id = $1`, [resolvedUserId]);

    const studentDataTables = await superuser.query(`
      SELECT col.table_name
      FROM information_schema.columns col
      JOIN information_schema.tables t
        ON t.table_schema = col.table_schema AND t.table_name = col.table_name
      WHERE col.table_schema = 'public'
        AND col.column_name = 'student_code'
        AND t.table_type = 'BASE TABLE'
      ORDER BY 1
    `);
    const tableNames = studentDataTables.rows.map((r) => r.table_name);
    // Verrou de coherence : si ce test cesse de trouver les deux tables
    // connues, c'est que le schema a change sans que ce test ait ete
    // revu - echec explicite plutot qu'un test qui ne verifie plus rien.
    expect(tableNames).toEqual(["grades", "student_averages"]);

    const exposedStudentViews = await superuser.query(`
      SELECT DISTINCT c.relname AS view_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col
        ON col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'student_code'
      WHERE c.relkind = 'v'
        AND n.nspname = 'public'
        AND has_table_privilege('app_role', c.oid, 'SELECT')
      ORDER BY 1
    `);
    const viewNames = exposedStudentViews.rows.map((r) => r.view_name);
    expect(viewNames.sort()).toEqual(["v_grades", "v_student_averages"]);

    for (const viewName of viewNames) {
      const result = await withAuthenticatedContext(resolvedUserId, async (c) => {
        const allRows = await c.query(`SELECT * FROM ${viewName}`);
        const countRow = await c.query(`SELECT COUNT(*) AS n FROM ${viewName}`);
        const perClass = await c.query(
          `SELECT class_id, COUNT(*) AS n FROM ${viewName} GROUP BY class_id`
        );
        return { allRows: allRows.rows, count: Number(countRow.rows[0].n), perClass: perClass.rows };
      });

      expect(result.allRows, `${viewName} : aucune ligne attendue`).toEqual([]);
      expect(result.count, `${viewName} : COUNT(*) doit etre 0, pas un agregat masque`).toBe(0);
      expect(
        result.perClass,
        `${viewName} : aucun effectif par classe, meme agrege, ne doit apparaitre`
      ).toEqual([]);
    }
  });
});
