/*
 * Controle manquant identifie dans docs/phase2/notes-phase2.md (section 0.1.d) :
 * aucun test ne garantissait qu'une FUTURE vue exposee a app_role applique
 * bien le filtre par unite. Ce fichier le construit.
 *
 * Detection (pas de liste ecrite a la main) : part des droits REELS de
 * app_role dans le catalogue systeme (has_table_privilege), donc une vue
 * ajoutee demain et GRANTee par erreur est vue sans que personne n'y pense.
 *
 * Deux approches pour le critere de conformite ont ete evaluees :
 *   A. Structurelle (lire pg_get_viewdef / verifier que la definition
 *      reference app_current_unit_ids()) - rejetee : un motif de texte
 *      ne prouve rien sur le comportement reel, et peut etre contourne
 *      par une ecriture SQL equivalente mais differente.
 *   B. Fonctionnelle (retenue) - inserer des lignes dans deux unites (ou
 *      deux identites) distinctes, interroger la vue via app_role avec un
 *      contexte pose sur un seul cote, verifier qu'aucune ligne de l'autre
 *      cote n'apparait. Prouve le comportement, pas l'intention. Limite
 *      assumee : ne couvre que les chemins reellement executes par ce
 *      test (voir docs/phase2/notes-phase2.md section 0.1.c pour les
 *      risques non couverts, ex. vues materialisees).
 *
 * Trois categories DECLAREES, versionnees et justifiees - pas deux. En
 * classifiant les 11 vues reelles, v_my_unit_grants a revele un cas que
 * la consigne initiale (colonne unit_id => teste par contexte d'unite,
 * sinon doit etre globale) ne prevoyait pas : cette vue A une colonne
 * unit_id, mais n'est PAS filtree par app.current_unit_ids - sa policy
 * reelle (self_only sur user_unit_grants) filtre par app.current_user_id.
 * Un critere "colonne unit_id presente => doit passer le test de contexte
 * d'unite" aurait fait echouer cette vue a tort. D'ou une 3e categorie,
 * testee avec le mecanisme d'isolation qui s'applique reellement a elle.
 *
 * Toute vue exposee a app_role et absente des trois listes fait echouer
 * le test - fermeture par defaut, pas par omission.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

// unit_id present, isolation via app.current_unit_ids (policy unit_isolation_select).
const UNIT_SCOPED_VIEWS = new Set(["v_classes", "v_periods", "v_grades", "v_student_averages"]);

// Isolation par identite (policy self_only), pas par unite. v_my_unit_grants a
// une colonne unit_id mais ce n'est pas le mecanisme qui la protege.
const IDENTITY_SCOPED_VIEWS = new Set(["v_my_profile", "v_my_unit_grants"]);

// Aucune donnee individualisee par eleve/unite. Justification par vue :
const GLOBAL_VIEWS = new Set([
  "v_units", // referentiel global (la liste des unites elle-meme)
  "v_levels", // referentiel global
  "v_subjects", // referentiel global
  "v_support_signal_config", // config pedagogique, table sans RLS (migration 5 : aucun ENABLE ROW LEVEL SECURITY), aucune colonne unit_id
  "v_latest_successful_etl_run", // agregat de fraicheur par "scope" (texte libre), aucune colonne unit_id, aucune ligne individualisee
]);

let superuser;

beforeAll(async () => {
  superuser = new Client({ connectionString: process.env.TEST_SUPERUSER_URL });
  await superuser.connect();
});

afterAll(async () => {
  await superuser.end();
});

async function getViewsExposedToAppRole() {
  const { rows } = await superuser.query(`
    SELECT c.relname AS view_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v'
      AND n.nspname = 'public'
      AND has_table_privilege('app_role', c.oid, 'SELECT')
    ORDER BY 1
  `);
  return rows.map((r) => r.view_name);
}

async function appRoleQuery(setupSql, sql, params) {
  const appRole = new Client({ connectionString: process.env.APP_ROLE_DATABASE_URL });
  await appRole.connect();
  try {
    await appRole.query("BEGIN");
    if (setupSql) await appRole.query(setupSql);
    const { rows } = await appRole.query(sql, params);
    await appRole.query("COMMIT");
    return rows;
  } finally {
    await appRole.end();
  }
}

/*
 * Verification fonctionnelle generique pour une vue unit-scoped : pose le
 * contexte sur unitA seule, et exige qu'aucune ligne dont id=idB
 * n'apparaisse. Utilisee a la fois sur les vraies vues et sur la vue
 * fautive ci-dessous - c'est le MEME code qui doit distinguer les deux.
 */
async function assertUnitIsolation(viewName, idA, idB, unitA) {
  const rows = await appRoleQuery(
    `SET LOCAL app.current_unit_ids = '${unitA}'`,
    `SELECT id, unit_id FROM ${viewName} WHERE id IN ($1, $2)`,
    [idA, idB]
  );
  expect(rows.map((r) => r.id)).not.toContain(idB);
}

/*
 * Verification fonctionnelle generique pour une vue identity-scoped : pose
 * app.current_user_id successivement sur idA puis idB, et exige dans
 * chaque sens que seule la ligne de l'identite posee apparaisse - jamais
 * celle de l'autre. Meme methode que assertUnitIsolation (fonctionnelle,
 * pas une simple declaration), demandee explicitement pour la categorie
 * self_only.
 */
async function assertIdentityIsolation(viewName, selectCol, idA, idB) {
  const rowsAsA = await appRoleQuery(
    `SET LOCAL app.current_user_id = '${idA}'`,
    `SELECT ${selectCol} FROM ${viewName} WHERE ${selectCol} IN ($1, $2)`,
    [idA, idB]
  );
  expect(rowsAsA.map((r) => r[selectCol])).toEqual([idA]);

  const rowsAsB = await appRoleQuery(
    `SET LOCAL app.current_user_id = '${idB}'`,
    `SELECT ${selectCol} FROM ${viewName} WHERE ${selectCol} IN ($1, $2)`,
    [idA, idB]
  );
  expect(rowsAsB.map((r) => r[selectCol])).toEqual([idB]);
}

describe("Meta-test : toute vue exposee a app_role est classifiee et verifiee", () => {
  let unitA, unitB, levelId, subjectId, classA, classB, periodA, periodB;
  let gradeA, gradeB, avgA, avgB;
  let userA, userB;

  beforeAll(async () => {
    const units = await superuser.query(
      `INSERT INTO units (code, name) VALUES ('MA', 'Meta A'), ('MB', 'Meta B') RETURNING id, code`
    );
    unitA = units.rows.find((r) => r.code === "MA").id;
    unitB = units.rows.find((r) => r.code === "MB").id;

    const level = await superuser.query(
      `INSERT INTO levels (code, name) VALUES ('ML1', 'Meta Niveau 1') RETURNING id`
    );
    levelId = level.rows[0].id;

    const subject = await superuser.query(
      `INSERT INTO subjects (code, name) VALUES ('MS1', 'Meta Matiere 1') RETURNING id`
    );
    subjectId = subject.rows[0].id;

    const classes = await superuser.query(
      `INSERT INTO classes (unit_id, level_id, name) VALUES ($1, $3, 'Meta Classe A'), ($2, $3, 'Meta Classe B') RETURNING id, unit_id`,
      [unitA, unitB, levelId]
    );
    classA = classes.rows.find((r) => r.unit_id === unitA).id;
    classB = classes.rows.find((r) => r.unit_id === unitB).id;

    const periods = await superuser.query(
      `INSERT INTO periods (unit_id, code, label) VALUES ($1, 'MP', 'Meta Periode A'), ($2, 'MP', 'Meta Periode B') RETURNING id, unit_id`,
      [unitA, unitB]
    );
    periodA = periods.rows.find((r) => r.unit_id === unitA).id;
    periodB = periods.rows.find((r) => r.unit_id === unitB).id;

    const grades = await superuser.query(
      `INSERT INTO grades (student_code, unit_id, class_id, subject_id, period_id, grade_value, grade_scale)
       VALUES (gen_random_uuid(), $1, $3, $5, $6, 15, 20),
              (gen_random_uuid(), $2, $4, $5, $7, 12, 20)
       RETURNING id, unit_id`,
      [unitA, unitB, classA, classB, subjectId, periodA, periodB]
    );
    gradeA = grades.rows.find((r) => r.unit_id === unitA).id;
    gradeB = grades.rows.find((r) => r.unit_id === unitB).id;

    const avgs = await superuser.query(
      `INSERT INTO student_averages (student_code, unit_id, class_id, subject_id, period_id, average_value)
       VALUES (gen_random_uuid(), $1, $3, $5, $6, 14),
              (gen_random_uuid(), $2, $4, $5, $7, 11)
       RETURNING id, unit_id`,
      [unitA, unitB, classA, classB, subjectId, periodA, periodB]
    );
    avgA = avgs.rows.find((r) => r.unit_id === unitA).id;
    avgB = avgs.rows.find((r) => r.unit_id === unitB).id;

    const users = await superuser.query(
      `INSERT INTO users (google_subject, email) VALUES ('meta-a', 'a@meta.test'), ('meta-b', 'b@meta.test') RETURNING id, google_subject`
    );
    userA = users.rows.find((r) => r.google_subject === "meta-a").id;
    userB = users.rows.find((r) => r.google_subject === "meta-b").id;

    await superuser.query(
      `INSERT INTO user_unit_grants (user_id, unit_id) VALUES ($1, $3), ($2, $4)`,
      [userA, userB, unitA, unitB]
    );
  });

  afterAll(async () => {
    await superuser.query(`DELETE FROM user_unit_grants WHERE user_id IN ($1, $2)`, [userA, userB]);
    await superuser.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userA, userB]);
    await superuser.query(`DELETE FROM student_averages WHERE id IN ($1, $2)`, [avgA, avgB]);
    await superuser.query(`DELETE FROM grades WHERE id IN ($1, $2)`, [gradeA, gradeB]);
    await superuser.query(`DELETE FROM periods WHERE id IN ($1, $2)`, [periodA, periodB]);
    await superuser.query(`DELETE FROM classes WHERE id IN ($1, $2)`, [classA, classB]);
    await superuser.query(`DELETE FROM subjects WHERE id = $1`, [subjectId]);
    await superuser.query(`DELETE FROM levels WHERE id = $1`, [levelId]);
    await superuser.query(`DELETE FROM units WHERE id IN ($1, $2)`, [unitA, unitB]);
  });

  it("toute vue exposee a app_role appartient a exactement une categorie declaree", async () => {
    const exposed = await getViewsExposedToAppRole();
    const unclassified = exposed.filter(
      (v) => !UNIT_SCOPED_VIEWS.has(v) && !IDENTITY_SCOPED_VIEWS.has(v) && !GLOBAL_VIEWS.has(v)
    );
    expect(unclassified).toEqual([]);
  });

  it("aucune vue declaree n'est obsolete (stale) : toutes les 3 listes ne contiennent que des vues reellement exposees", async () => {
    const exposed = new Set(await getViewsExposedToAppRole());
    const declared = [...UNIT_SCOPED_VIEWS, ...IDENTITY_SCOPED_VIEWS, ...GLOBAL_VIEWS];
    const stale = declared.filter((v) => !exposed.has(v));
    expect(stale).toEqual([]);
  });

  it("v_classes isole par unite", async () => {
    await assertUnitIsolation("v_classes", classA, classB, unitA);
  });

  it("v_periods isole par unite", async () => {
    await assertUnitIsolation("v_periods", periodA, periodB, unitA);
  });

  it("v_grades isole par unite", async () => {
    await assertUnitIsolation("v_grades", gradeA, gradeB, unitA);
  });

  it("v_student_averages isole par unite", async () => {
    await assertUnitIsolation("v_student_averages", avgA, avgB, unitA);
  });

  it("v_my_profile isole par identite dans les deux sens : chaque utilisateur ne voit que sa propre ligne", async () => {
    await assertIdentityIsolation("v_my_profile", "id", userA, userB);
  });

  it("v_my_unit_grants isole par identite dans les deux sens : aucun des deux ne voit les lignes de l'autre", async () => {
    await assertIdentityIsolation("v_my_unit_grants", "user_id", userA, userB);
  });

  it("v_my_unit_grants isole par identite : un contexte d'unite pointant vers l'AUTRE unite ne fait pas fuiter la ligne de B", async () => {
    // Piege deliberement pose : app.current_unit_ids = unitB (pas unitA),
    // pour prouver que ce n'est PAS ce qui protege cette vue.
    const rows = await appRoleQuery(
      `SET LOCAL app.current_user_id = '${userA}'; SET LOCAL app.current_unit_ids = '${unitB}'`,
      `SELECT user_id, unit_id FROM v_my_unit_grants WHERE user_id IN ($1, $2)`,
      [userA, userB]
    );
    expect(rows.map((r) => r.user_id)).toEqual([userA]);
  });

  it("vues globales declarees : lisibles par app_role sans aucun contexte pose", async () => {
    for (const viewName of GLOBAL_VIEWS) {
      const rows = await appRoleQuery(null, `SELECT 1 FROM ${viewName} LIMIT 1`, []);
      // Pas d'assertion sur le contenu (certaines sont vides par design,
      // ex. v_support_signal_config tant qu'aucun seuil n'est valide) -
      // seulement que la lecture ne leve pas d'erreur de permission.
      expect(Array.isArray(rows)).toBe(true);
    }
  });

  it("preuve d'echec : une vue fautive (DEFINER = superutilisateur, BYPASSRLS) echappe au filtre, et le test generique le detecte", async () => {
    await superuser.query(`CREATE VIEW v_fautive_classes AS SELECT id, unit_id, name FROM classes`);
    await superuser.query(`GRANT SELECT ON v_fautive_classes TO app_role`);
    try {
      // 1. La detection par droits reels la voit, sans qu'on l'ait ecrite nulle part.
      const exposed = await getViewsExposedToAppRole();
      expect(exposed).toContain("v_fautive_classes");

      // 2. Non declaree dans aucune des 3 listes => le test de couverture
      //    globale (premier test ci-dessus) la ferait echouer. On le
      //    revalide ici isolement pour un message explicite.
      const isDeclared =
        UNIT_SCOPED_VIEWS.has("v_fautive_classes") ||
        IDENTITY_SCOPED_VIEWS.has("v_fautive_classes") ||
        GLOBAL_VIEWS.has("v_fautive_classes");
      expect(isDeclared).toBe(false);

      // 3. Le critere FONCTIONNEL lui-meme la detecte aussi, independamment
      //    de la classification : interrogee comme si elle etait
      //    unit-scoped (ce que sa colonne unit_id suggererait a tort),
      //    elle laisse fuiter la ligne de l'unite B malgre un contexte
      //    pose sur l'unite A seule - parce qu'elle est DEFINER-style sous
      //    le superutilisateur, qui a BYPASSRLS, donc FORCE ROW LEVEL
      //    SECURITY sur classes ne s'applique pas du tout a cette vue.
      let caught;
      try {
        await assertUnitIsolation("v_fautive_classes", classA, classB, unitA);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
      expect(caught.message).toMatch(/expected .* to not include/i);
    } finally {
      await superuser.query(`REVOKE SELECT ON v_fautive_classes FROM app_role`);
      await superuser.query(`DROP VIEW v_fautive_classes`);
    }
  });
});
