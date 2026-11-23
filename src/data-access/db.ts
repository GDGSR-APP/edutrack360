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
 * Pose le contexte d'unites en TRANSACTION-LOCALE (SET LOCAL), jamais au
 * niveau session - une fuite via pooling de connexions sinon (risque
 * identifie dans le plan, section isolation).
 */
export async function withUnitContext<T>(
  unitIds: readonly string[],
  run: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_unit_ids', $1, true)", [
      unitIds.join(","),
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
