import { sealData, unsealData } from "iron-session";

/*
 * Session applicative (A2). Deux scellements SEPARES, deux mots de passe
 * SEPARES :
 *
 * 1. Session (apres login reussi) : cookie httpOnly, sameSite STRICT,
 *    secure en HTTPS. Ne contient QUE l'id applicatif - jamais un jeton
 *    Google, jamais une revendication brute.
 *
 * 2. Flux de login (avant callback) : doit survivre la redirection
 *    cross-site depuis Google vers /callback. Un cookie sameSite=strict
 *    n'est PAS envoye sur cette navigation initiee par un tiers - ce
 *    cookie-ci doit etre sameSite=LAX, de tres courte duree de vie, et
 *    n'est jamais le cookie de session. Les deux ne doivent jamais
 *    pouvoir se descelller l'un comme l'autre (mots de passe distincts).
 *
 * Primitives bas niveau d'iron-session (sealData/unsealData), pas les
 * aides liees a un framework - aucun framework HTTP n'est choisi pour ce
 * projet (docs/phase3/notes-phase3.md, section 4).
 */

export interface SessionPayload {
  userId: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h, choix explicite - pas le defaut de 14 jours d'iron-session

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function createSessionCookieValue(
  payload: SessionPayload,
  password: string
): Promise<string> {
  return sealData(payload, { password, ttl: SESSION_TTL_SECONDS });
}

/*
 * unsealData ne rejette jamais sur un sceau invalide/expire - elle resout
 * un objet vide (comportement documente d'iron-session). D'ou la
 * verification de forme explicite ci-dessous : un sceau invalide doit
 * etre traite comme "pas de session", jamais comme une erreur qui
 * remonterait ou comme un userId partiel/invente.
 */
export async function readSessionCookieValue(
  seal: string,
  password: string
): Promise<SessionPayload | null> {
  const data = await unsealData<Partial<SessionPayload>>(seal, {
    password,
    ttl: SESSION_TTL_SECONDS,
  });
  if (typeof data.userId !== "string" || data.userId.length === 0) {
    return null;
  }
  return { userId: data.userId };
}

export interface LoginFlowPayload {
  codeVerifier: string;
  state: string;
  nonce: string;
  redirectUri: string;
}

const LOGIN_FLOW_TTL_SECONDS = 60 * 10; // 10 minutes - couvre l'aller-retour vers Google, rien de plus

export function loginFlowCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: LOGIN_FLOW_TTL_SECONDS,
  };
}

export async function createLoginFlowCookieValue(
  payload: LoginFlowPayload,
  password: string
): Promise<string> {
  return sealData(payload, { password, ttl: LOGIN_FLOW_TTL_SECONDS });
}

export async function readLoginFlowCookieValue(
  seal: string,
  password: string
): Promise<LoginFlowPayload | null> {
  const data = await unsealData<Partial<LoginFlowPayload>>(seal, {
    password,
    ttl: LOGIN_FLOW_TTL_SECONDS,
  });
  if (
    typeof data.codeVerifier !== "string" ||
    typeof data.state !== "string" ||
    typeof data.nonce !== "string" ||
    typeof data.redirectUri !== "string"
  ) {
    return null;
  }
  return {
    codeVerifier: data.codeVerifier,
    state: data.state,
    nonce: data.nonce,
    redirectUri: data.redirectUri,
  };
}
