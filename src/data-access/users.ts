import { getPool } from "./db";

/*
 * Resolution d'identite au premier login (A2, Phase 3). Appelle
 * find_or_create_user (migration 10, SECURITY DEFINER), jamais la table
 * users directement - app_role n'a aucun grant sur elle (A1). Ne prend en
 * entree que ce que le jeton Google valide a deja fourni - aucun champ
 * d'autorisation, cette fonction ne touche jamais user_unit_grants.
 */
export async function findOrCreateUser(
  googleSubject: string,
  email: string,
  displayName: string | null
): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    "SELECT find_or_create_user($1, $2, $3) AS id",
    [googleSubject, email, displayName]
  );
  return rows[0].id;
}
