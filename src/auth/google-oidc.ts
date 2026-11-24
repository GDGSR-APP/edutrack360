import * as client from "openid-client";

/*
 * Verification cote serveur d'un jeton Google Workspace (A2). Module pur,
 * independant de tout framework HTTP - aucun framework n'a ete choisi
 * pour ce projet (docs/phase3/notes-phase3.md, section 4) ; le cablage
 * des routes concretes est reporte a la Phase 8.
 *
 * openid-client.authorizationCodeGrant() verifie deja, par construction
 * (bibliotheque conforme OIDC) : emetteur, audience, expiration, signature,
 * state, nonce, PKCE. Ce module ajoute les controles propres a ce projet
 * qu'openid-client ne fait pas lui-meme : revendication hd (jamais le
 * suffixe de l'adresse), email_verified obligatoire.
 */

export class GoogleAuthError extends Error {}

export interface GoogleOidcSettings {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  /*
   * Usage LOCAL/TEST UNIQUEMENT (faux fournisseur d'identite sans TLS).
   * Ne doit jamais etre active en dehors des tests - aucune variable
   * d'environnement ne doit permettre de l'activer en production.
   */
  allowInsecureDiscoveryForTestsOnly?: boolean;
}

export async function createGoogleOidcConfig(
  settings: GoogleOidcSettings
): Promise<client.Configuration> {
  /*
   * Trouvaille empirique (docs/phase3/notes-phase3.md) : openid-client NE
   * VERIFIE PAS la signature du jeton par defaut sur le flux Authorization
   * Code - il considere que le canal TLS direct vers le token endpoint
   * authentifie deja l'emetteur, et documente la verification de
   * signature comme reservee a la "non-repudiation". Le plan exige la
   * verification de signature comme controle explicite et independant,
   * pas seulement la confiance TLS - enableNonRepudiationChecks force la
   * verification cryptographique reelle, verifie par une signature
   * fabriquee qui echoue desormais.
   */
  const execute = [client.enableNonRepudiationChecks];
  if (settings.allowInsecureDiscoveryForTestsOnly) {
    execute.push(client.allowInsecureRequests);
  }
  return client.discovery(
    settings.issuer,
    settings.clientId,
    settings.clientSecret,
    undefined,
    { execute }
  );
}

export interface LoginRedirect {
  url: URL;
  codeVerifier: string;
  state: string;
  nonce: string;
}

export async function buildLoginRedirect(
  config: client.Configuration,
  redirectUri: string
): Promise<LoginRedirect> {
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const nonce = client.randomNonce();
  const state = client.randomState();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    // openid seul suffit pour l'identite ; email+profile pour les
    // revendications utilisees (email, email_verified, hd, name). Aucun
    // scope d'acces a une API tierce - rien a stocker.
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    nonce,
    state,
  });
  return { url, codeVerifier, state, nonce };
}

export interface CallbackChecks {
  codeVerifier: string;
  expectedState: string;
  expectedNonce: string;
}

export interface VerifiedGoogleIdentity {
  googleSubject: string;
  email: string;
  displayName: string | null;
}

/*
 * Ne retourne JAMAIS les jetons (access/refresh/id token) - seulement les
 * revendications derivees necessaires a find_or_create_user. Rien n'est
 * stocke en base (A2).
 */
export async function verifyGoogleCallback(
  config: client.Configuration,
  currentUrl: URL,
  checks: CallbackChecks,
  allowedDomain: string
): Promise<VerifiedGoogleIdentity> {
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: checks.codeVerifier,
    expectedState: checks.expectedState,
    expectedNonce: checks.expectedNonce,
  });

  const claims = tokens.claims();
  if (!claims) {
    throw new GoogleAuthError("Aucune revendication de jeton d'identite recue.");
  }

  if (claims.email_verified !== true) {
    throw new GoogleAuthError("email_verified n'est pas true.");
  }

  // Controle sur la revendication hd, JAMAIS sur le suffixe de l'adresse
  // email (docs/architecture/authentification-google.md). Un hd absent
  // est un refus, pas un cas par defaut.
  if (typeof claims.hd !== "string" || claims.hd !== allowedDomain) {
    throw new GoogleAuthError(
      `Revendication hd absente ou differente du domaine attendu (recu: ${JSON.stringify(claims.hd)}).`
    );
  }

  if (typeof claims.email !== "string" || claims.email.length === 0) {
    throw new GoogleAuthError("Revendication email absente.");
  }

  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new GoogleAuthError("Revendication sub absente.");
  }

  return {
    googleSubject: claims.sub,
    email: claims.email,
    displayName: typeof claims.name === "string" ? claims.name : null,
  };
}
