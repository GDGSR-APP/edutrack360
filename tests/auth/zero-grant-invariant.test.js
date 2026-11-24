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
import * as client from "openid-client";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

import { createGoogleOidcConfig, verifyGoogleCallback } from "../../src/auth/google-oidc.ts";
import { findOrCreateUser } from "../../src/data-access/users.ts";
import { getGradesForUser } from "../../src/data-access/grades.ts";
import { startFakeGoogleIdp } from "./fake-google-idp.js";

const ALLOWED_DOMAIN = "ecoles-test.ma";
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
const REDIRECT_URI = "http://localhost/callback";

let idp;
let oidcConfig;
let superuser;
let unitA, unitB, levelId, subjectId, classA, classB, periodA, periodB, gradeA, gradeB;
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
});

afterAll(async () => {
  if (resolvedUserId) {
    await superuser.query(`DELETE FROM user_unit_grants WHERE user_id = $1`, [resolvedUserId]);
    await superuser.query(`DELETE FROM users WHERE id = $1`, [resolvedUserId]);
  }
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
});
