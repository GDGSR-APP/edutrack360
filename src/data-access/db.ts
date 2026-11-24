/*
 * Seul fichier du code applicatif autorise a importer "pg" (A1). Toute
 * requete DB passe par ce pool, qui se connecte avec APP_ROLE_DATABASE_URL
 * (app_role : aucun grant table de base, uniquement sur les vues de la
 * couche d'acces, migration 20261123000009_access_layer_views.cjs).
 */
import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.APP_ROLE_DATABASE_URL;
    if (!connectionString) {
      throw new Error("APP_ROLE_DATABASE_URL non defini.");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/*
 * Pose le contexte en TRANSACTION-LOCALE (SET LOCAL), jamais au niveau
 * session - une fuite via pooling de connexions sinon (risque identifie
 * dans le plan, section isolation).
 *
 * L'ensemble d'unites n'est JAMAIS fourni par l'appelant (Phase 2->3,
 * correction) : un appelant qui passerait des unitIds non valides serait
 * l'autorisation elle-meme, ce qui la rend contournable par construction.
 * Il est relu depuis v_my_unit_grants, dans la MEME transaction, apres
 * avoir pose l'identite - l'invariant central de la Phase 3 (aucune ligne
 * dans user_unit_grants => aucune donnee visible) decoule directement de
 * ce mecanisme, pas d'une verification ajoutee a part.
 */
export async function withAuthenticatedContext<T>(
  userId: string,
  run: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const { rows } = await client.query<{ unit_id: string }>(
      "SELECT unit_id FROM v_my_unit_grants"
    );
    await client.query("SELECT set_config('app.current_unit_ids', $1, true)", [
      rows.map((row) => row.unit_id).join(","),
    ]);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
