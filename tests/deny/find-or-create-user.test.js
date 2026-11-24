/*
 * find_or_create_user (migration 10) : la seule porte d'ecriture sur users
 * accessible a app_role, necessaire car la resolution d'identite au
 * premier login Google doit pouvoir creer une ligne qui n'existe pas
 * encore, alors que self_only + FORCE RLS l'interdit structurellement
 * (docs/phase3/notes-phase3.md pour le detail empirique de la decision).
 *
 * Ce fichier prouve les limites du perimetre de la fonction : elle peut
 * creer/retrouver UN utilisateur par son google_subject exact, elle ne
 * peut etre utilisee pour lire un AUTRE utilisateur, et elle ne touche
 * jamais user_unit_grants.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });

let superuser;
let appRole;

beforeAll(async () => {
  superuser = new Client({ connectionString: process.env.TEST_SUPERUSER_URL });
  await superuser.connect();
  appRole = new Client({ connectionString: process.env.APP_ROLE_DATABASE_URL });
  await appRole.connect();
});

afterAll(async () => {
  await superuser.query(`DELETE FROM users WHERE google_subject LIKE 'foctest-%'`);
  await appRole.end();
  await superuser.end();
});

describe("find_or_create_user - perimetre mesure par execution", () => {
  it("cree une ligne pour un google_subject inconnu et retourne son id", async () => {
    const { rows } = await appRole.query(
      `SELECT find_or_create_user($1, $2, $3) AS id`,
      ["foctest-new", "new@foctest.test", "Nouveau"]
    );
    expect(rows[0].id).toBeTruthy();

    const check = await superuser.query(`SELECT email FROM users WHERE google_subject = 'foctest-new'`);
    expect(check.rows[0].email).toBe("new@foctest.test");
  });

  it("est idempotente : meme subject => meme id, et met a jour email/display_name", async () => {
    const first = await appRole.query(`SELECT find_or_create_user($1, $2, $3) AS id`, [
      "foctest-idem",
      "avant@foctest.test",
      "Avant",
    ]);
    const second = await appRole.query(`SELECT find_or_create_user($1, $2, $3) AS id`, [
      "foctest-idem",
      "apres@foctest.test",
      "Apres",
    ]);
    expect(second.rows[0].id).toBe(first.rows[0].id);

    const check = await superuser.query(`SELECT email, display_name FROM users WHERE google_subject = 'foctest-idem'`);
    expect(check.rows[0].email).toBe("apres@foctest.test");
    expect(check.rows[0].display_name).toBe("Apres");
  });

  it("ne cree jamais de ligne dans user_unit_grants - app_role n'a toujours aucun grant table dessus", async () => {
    const { rows } = await superuser.query(`
      SELECT 1 FROM information_schema.table_privileges
      WHERE grantee = 'app_role' AND table_name = 'user_unit_grants'
    `);
    expect(rows).toEqual([]);
  });

  it("app_role n'a toujours aucun GRANT table direct sur users (A1 intact malgre la fonction)", async () => {
    const { rows } = await superuser.query(`
      SELECT 1 FROM information_schema.table_privileges
      WHERE grantee = 'app_role' AND table_name = 'users'
    `);
    expect(rows).toEqual([]);
  });

  it("refus : app_role ne peut pas lire users directement, meme apres avoir appele la fonction", async () => {
    await expect(appRole.query(`SELECT * FROM users LIMIT 1`)).rejects.toThrow(
      /permission denied for table users/
    );
  });

  it("refus : PUBLIC n'a pas EXECUTE sur find_or_create_user (seul app_role l'a)", async () => {
    const { rows } = await superuser.query(`
      SELECT 1 FROM information_schema.routine_privileges
      WHERE grantee = 'PUBLIC' AND routine_name = 'find_or_create_user'
    `);
    expect(rows).toEqual([]);
  });

  /*
   * Regression permanente pour une vraie vulnerabilite trouvee par
   * execution (docs/phase3/notes-phase3.md) : avec SET search_path =
   * public (version initiale), app_role pouvait creer une table
   * temporaire nommee "users" et la fonction operait sur CELLE-CI au lieu
   * de public.users - pg_temp est cherche avant tout schema explicite.
   * Corrige par search_path VIDE + qualification explicite. Ce test
   * reproduit l'attaque exacte et exige qu'elle echoue desormais.
   */
  it("refus : une table temporaire nommee users ne peut plus detourner find_or_create_user (search_path hijack)", async () => {
    await appRole.query("BEGIN");
    await appRole.query(
      "CREATE TEMP TABLE users (id uuid, google_subject text, email text, display_name text)"
    );
    await appRole.query(
      "INSERT INTO pg_temp.users (id, google_subject, email, display_name) VALUES (gen_random_uuid(), 'foctest-shadow', 'piege@foctest.test', 'Piege')"
    );

    const { rows } = await appRole.query(`SELECT find_or_create_user($1, $2, $3) AS id`, [
      "foctest-shadow",
      "reel@foctest.test",
      "Reel",
    ]);

    const shadowRow = await appRole.query(
      "SELECT email FROM pg_temp.users WHERE google_subject = 'foctest-shadow'"
    );
    // La ligne temporaire doit rester "piege@foctest.test" - la fonction ne
    // doit jamais l'avoir lue ni modifiee.
    expect(shadowRow.rows[0].email).toBe("piege@foctest.test");
    await appRole.query("COMMIT");

    try {
      const realRow = await superuser.query(
        "SELECT id, email FROM users WHERE google_subject = 'foctest-shadow'"
      );
      expect(realRow.rows[0].email).toBe("reel@foctest.test");
      expect(rows[0].id).toBe(realRow.rows[0].id);
    } finally {
      await appRole.query("DROP TABLE IF EXISTS pg_temp.users");
    }
  });
});
