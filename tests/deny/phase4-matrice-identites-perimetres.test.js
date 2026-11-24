/*
 * Phase 4 (A4) : matrice de refus demandee par le directeur de projet,
 * "par role et par unite, incluant le cas authentifie, aucun perimetre".
 *
 * Lecture retenue pour "par role", signalee explicitement plutot que
 * decidee en silence : ce depot n'a qu'UNE identite applicative
 * (app_role + une ligne dans users, perimetre defini par user_unit_grants) -
 * aucune colonne "role" (directeur d'unite / direction generale) n'existe
 * dans le schema, et A4 n'en demande pas (les grants sont "administres a
 * la main"). "Par role" est donc interprete ici comme les ETATS DE
 * PERIMETRE reels qu'un compte peut avoir, pas des roles Postgres :
 *
 *   R1 - aucun contexte applicatif pose du tout (jamais passe par
 *        find_or_create_user/withAuthenticatedContext)
 *   R2 - authentifie, ZERO grant (deja couvert en Phase 3, reconfirme ici
 *        dans la matrice complete pour ne pas le fragmenter)
 *   R3 - authentifie, un seul grant (profil "directeur d'unite")
 *   R4 - authentifie, grants sur PLUSIEURS unites (profil "direction
 *        generale" - A4 : pas de role special, juste plusieurs lignes)
 *   R5 - userId syntaxiquement valide mais qui ne correspond a AUCUNE
 *        ligne reelle de `users` (session corrompue/perimee/forgee)
 *
 * Croisees avec toutes les vues exposees a app_role qui portent une
 * notion d'unite ou d'identite (les vues globales sont hors perimetre -
 * decision actee, Phase 3 section 9).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

import { withAuthenticatedContext } from "../../src/data-access/db.ts";

let superuser;
let unitA, unitB, unitC, levelId, subjectId;
let classA, classB, classC, periodA, periodB, periodC, gradeA, gradeB, gradeC;
let averageA, averageB, averageC;
let userNoGrant, userOneGrant, userMultiGrant;

beforeAll(async () => {
  superuser = new Client({ connectionString: process.env.TEST_SUPERUSER_URL });
  await superuser.connect();

  const units = await superuser.query(
    `INSERT INTO units (code, name) VALUES ('P4A', 'Phase4 A'), ('P4B', 'Phase4 B'), ('P4C', 'Phase4 C') RETURNING id, code`
  );
  unitA = units.rows.find((r) => r.code === "P4A").id;
  unitB = units.rows.find((r) => r.code === "P4B").id;
  unitC = units.rows.find((r) => r.code === "P4C").id;

  const level = await superuser.query(
    `INSERT INTO levels (code, name) VALUES ('P4L1', 'Phase4 Niveau 1') RETURNING id`
  );
  levelId = level.rows[0].id;

  const subject = await superuser.query(
    `INSERT INTO subjects (code, name) VALUES ('P4S1', 'Phase4 Matiere 1') RETURNING id`
  );
  subjectId = subject.rows[0].id;

  const classes = await superuser.query(
    `INSERT INTO classes (unit_id, level_id, name)
     VALUES ($1, $4, 'P4 Classe A'), ($2, $4, 'P4 Classe B'), ($3, $4, 'P4 Classe C')
     RETURNING id, unit_id`,
    [unitA, unitB, unitC, levelId]
  );
  classA = classes.rows.find((r) => r.unit_id === unitA).id;
  classB = classes.rows.find((r) => r.unit_id === unitB).id;
  classC = classes.rows.find((r) => r.unit_id === unitC).id;

  const periods = await superuser.query(
    `INSERT INTO periods (unit_id, code, label)
     VALUES ($1, 'P4P', 'P4 Periode A'), ($2, 'P4P', 'P4 Periode B'), ($3, 'P4P', 'P4 Periode C')
     RETURNING id, unit_id`,
    [unitA, unitB, unitC]
  );
  periodA = periods.rows.find((r) => r.unit_id === unitA).id;
  periodB = periods.rows.find((r) => r.unit_id === unitB).id;
  periodC = periods.rows.find((r) => r.unit_id === unitC).id;

  const grades = await superuser.query(
    `INSERT INTO grades (student_code, unit_id, class_id, subject_id, period_id, grade_value, grade_scale)
     VALUES (gen_random_uuid(), $1, $4, $7, $8, 10, 20),
            (gen_random_uuid(), $2, $5, $7, $9, 11, 20),
            (gen_random_uuid(), $3, $6, $7, $10, 12, 20)
     RETURNING id, unit_id`,
    [unitA, unitB, unitC, classA, classB, classC, subjectId, periodA, periodB, periodC]
  );
  gradeA = grades.rows.find((r) => r.unit_id === unitA).id;
  gradeB = grades.rows.find((r) => r.unit_id === unitB).id;
  gradeC = grades.rows.find((r) => r.unit_id === unitC).id;

  const averages = await superuser.query(
    `INSERT INTO student_averages (student_code, unit_id, class_id, subject_id, period_id, average_value)
     VALUES (gen_random_uuid(), $1, $4, $7, $8, 10),
            (gen_random_uuid(), $2, $5, $7, $9, 11),
            (gen_random_uuid(), $3, $6, $7, $10, 12)
     RETURNING id, unit_id`,
    [unitA, unitB, unitC, classA, classB, classC, subjectId, periodA, periodB, periodC]
  );
  averageA = averages.rows.find((r) => r.unit_id === unitA).id;
  averageB = averages.rows.find((r) => r.unit_id === unitB).id;
  averageC = averages.rows.find((r) => r.unit_id === unitC).id;

  const users = await superuser.query(
    `INSERT INTO users (google_subject, email) VALUES
       ('p4-no-grant', 'no-grant@p4.test'),
       ('p4-one-grant', 'one-grant@p4.test'),
       ('p4-multi-grant', 'multi-grant@p4.test')
     RETURNING id, google_subject`
  );
  userNoGrant = users.rows.find((r) => r.google_subject === "p4-no-grant").id;
  userOneGrant = users.rows.find((r) => r.google_subject === "p4-one-grant").id;
  userMultiGrant = users.rows.find((r) => r.google_subject === "p4-multi-grant").id;

  await superuser.query(
    `INSERT INTO user_unit_grants (user_id, unit_id) VALUES
       ($1, $3),
       ($2, $3), ($2, $4)`,
    [userOneGrant, userMultiGrant, unitA, unitB]
  );
});

afterAll(async () => {
  await superuser.query(`DELETE FROM user_unit_grants WHERE user_id IN ($1, $2, $3)`, [
    userNoGrant,
    userOneGrant,
    userMultiGrant,
  ]);
  await superuser.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [
    userNoGrant,
    userOneGrant,
    userMultiGrant,
  ]);
  await superuser.query(`DELETE FROM student_averages WHERE id IN ($1, $2, $3)`, [
    averageA,
    averageB,
    averageC,
  ]);
  await superuser.query(`DELETE FROM grades WHERE id IN ($1, $2, $3)`, [gradeA, gradeB, gradeC]);
  await superuser.query(`DELETE FROM periods WHERE id IN ($1, $2, $3)`, [periodA, periodB, periodC]);
  await superuser.query(`DELETE FROM classes WHERE id IN ($1, $2, $3)`, [classA, classB, classC]);
  await superuser.query(`DELETE FROM subjects WHERE id = $1`, [subjectId]);
  await superuser.query(`DELETE FROM levels WHERE id = $1`, [levelId]);
  await superuser.query(`DELETE FROM units WHERE id IN ($1, $2, $3)`, [unitA, unitB, unitC]);
  await superuser.end();
});

/*
 * Interroge les 4 vues unit-scoped a travers withAuthenticatedContext (le
 * SEUL chemin reel de l'application - jamais un contexte pose a la main
 * en dehors de ce mecanisme) et retourne les id visibles pour chacune.
 */
async function visibleUnitScopedIds(userId) {
  return withAuthenticatedContext(userId, async (c) => {
    const classes = await c.query(`SELECT id FROM v_classes`);
    const periods = await c.query(`SELECT id FROM v_periods`);
    const grades = await c.query(`SELECT id FROM v_grades`);
    const averages = await c.query(`SELECT id FROM v_student_averages`);
    return {
      classes: classes.rows.map((r) => r.id),
      periods: periods.rows.map((r) => r.id),
      grades: grades.rows.map((r) => r.id),
      averages: averages.rows.map((r) => r.id),
    };
  });
}

describe("Phase 4 - matrice de refus par etat de perimetre x par vue", () => {
  it("R1 - aucun contexte applicatif pose : app_role seul, sans passer par withAuthenticatedContext, ne voit rien", async () => {
    const { Client: PgClient } = await import("pg");
    const appRole = new PgClient({ connectionString: process.env.APP_ROLE_DATABASE_URL });
    await appRole.connect();
    try {
      const { rows } = await appRole.query(`SELECT id FROM v_classes`);
      expect(rows).toEqual([]);
    } finally {
      await appRole.end();
    }
  });

  it("R2 - authentifie, ZERO grant : aucune ligne sur les 4 vues unit-scoped (reconfirme dans la matrice complete)", async () => {
    const visible = await visibleUnitScopedIds(userNoGrant);
    expect(visible).toEqual({ classes: [], periods: [], grades: [], averages: [] });
  });

  it("R3 - authentifie, UN grant (unite A) : voit exactement et seulement l'unite A sur les 4 vues", async () => {
    const visible = await visibleUnitScopedIds(userOneGrant);
    expect(visible).toEqual({
      classes: [classA],
      periods: [periodA],
      grades: [gradeA],
      averages: [averageA],
    });
  });

  it("R4 - authentifie, PLUSIEURS grants (A+B) : voit exactement A et B, jamais C", async () => {
    const visible = await visibleUnitScopedIds(userMultiGrant);
    expect(visible.classes.sort()).toEqual([classA, classB].sort());
    expect(visible.periods.sort()).toEqual([periodA, periodB].sort());
    expect(visible.grades.sort()).toEqual([gradeA, gradeB].sort());
    expect(visible.averages.sort()).toEqual([averageA, averageB].sort());
    for (const list of Object.values(visible)) {
      expect(list).not.toContain(classC);
      expect(list).not.toContain(periodC);
      expect(list).not.toContain(gradeC);
      expect(list).not.toContain(averageC);
    }
  });

  it("R5 - userId syntaxiquement valide mais sans ligne reelle dans users : aucune ligne (session forgee/perimee)", async () => {
    const neverExistedUserId = "00000000-0000-0000-0000-000000000000";
    const visible = await visibleUnitScopedIds(neverExistedUserId);
    expect(visible).toEqual({ classes: [], periods: [], grades: [], averages: [] });
  });

  it("identite (v_my_profile) : chaque utilisateur ne voit que sa propre ligne, quel que soit son nombre de grants", async () => {
    for (const [userId, email] of [
      [userNoGrant, "no-grant@p4.test"],
      [userOneGrant, "one-grant@p4.test"],
      [userMultiGrant, "multi-grant@p4.test"],
    ]) {
      const rows = await withAuthenticatedContext(userId, async (c) => {
        const { rows } = await c.query(`SELECT id, email FROM v_my_profile`);
        return rows;
      });
      expect(rows).toEqual([{ id: userId, email }]);
    }
  });

  it("identite (v_my_unit_grants) : le nombre de lignes visibles correspond exactement au nombre de grants reels de chaque utilisateur", async () => {
    const noGrantRows = await withAuthenticatedContext(userNoGrant, (c) =>
      c.query(`SELECT unit_id FROM v_my_unit_grants`).then((r) => r.rows)
    );
    const oneGrantRows = await withAuthenticatedContext(userOneGrant, (c) =>
      c.query(`SELECT unit_id FROM v_my_unit_grants`).then((r) => r.rows)
    );
    const multiGrantRows = await withAuthenticatedContext(userMultiGrant, (c) =>
      c.query(`SELECT unit_id FROM v_my_unit_grants`).then((r) => r.rows)
    );

    expect(noGrantRows).toEqual([]);
    expect(oneGrantRows.map((r) => r.unit_id)).toEqual([unitA]);
    expect(multiGrantRows.map((r) => r.unit_id).sort()).toEqual([unitA, unitB].sort());
  });
});
