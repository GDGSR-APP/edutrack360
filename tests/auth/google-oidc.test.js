/*
 * Matrice de refus pour verifyGoogleCallback (A2). Chaque cas produit un
 * jeton REELLEMENT invalide (signe par un faux IdP HTTP local, pas un
 * objet de reclamations simule) et verifie que la verification rejette -
 * "verifie par execution et non par affirmation", comme pour le reste de
 * ce depot.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as client from "openid-client";
import {
  createGoogleOidcConfig,
  verifyGoogleCallback,
  GoogleAuthError,
} from "../../src/auth/google-oidc.ts";
import { startFakeGoogleIdp } from "./fake-google-idp.js";

const ALLOWED_DOMAIN = "ecoles-test.ma";
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";
const REDIRECT_URI = "http://localhost/callback";

let idp;
let config;

beforeAll(async () => {
  idp = await startFakeGoogleIdp();
  config = await createGoogleOidcConfig({
    issuer: idp.issuerUrl,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    allowInsecureDiscoveryForTestsOnly: true,
  });
});

afterAll(async () => {
  await idp.close();
});

function defaultClaims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: idp.issuerUrl.origin,
    aud: CLIENT_ID,
    sub: "google-sub-123",
    iat: now,
    exp: now + 3600,
    hd: ALLOWED_DOMAIN,
    email: `user@${ALLOWED_DOMAIN}`,
    email_verified: true,
    name: "Utilisateur Test",
    ...overrides,
  };
}

/*
 * Prepare un appel complet (nonce/state/PKCE + jeton configure sur le faux
 * IdP) et retourne la promesse de verifyGoogleCallback - au test d'asserter
 * resolve ou reject selon le cas.
 */
async function runCallback({ claimsOverrides = {}, badSignature = false, expectedStateOverride, expectedNonceOverride } = {}) {
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();

  await idp.setNextIdToken(defaultClaims({ nonce, ...claimsOverrides }), { badSignature });

  const currentUrl = new URL(REDIRECT_URI);
  currentUrl.searchParams.set("code", "fake-authorization-code");
  currentUrl.searchParams.set("state", state);

  return verifyGoogleCallback(
    config,
    currentUrl,
    {
      codeVerifier,
      expectedState: expectedStateOverride ?? state,
      expectedNonce: expectedNonceOverride ?? nonce,
    },
    ALLOWED_DOMAIN
  );
}

describe("verifyGoogleCallback - cas valide", () => {
  it("accepte un jeton reellement valide et retourne l'identite derivee, sans jeton brut", async () => {
    const identity = await runCallback();
    expect(identity).toEqual({
      googleSubject: "google-sub-123",
      email: `user@${ALLOWED_DOMAIN}`,
      displayName: "Utilisateur Test",
    });
  });
});

describe("verifyGoogleCallback - matrice de refus", () => {
  it("refuse une signature invalide (clef non publiee dans /jwks)", async () => {
    await expect(runCallback({ badSignature: true })).rejects.toThrow();
  });

  it("refuse un iss different de l'emetteur configure", async () => {
    await expect(runCallback({ claimsOverrides: { iss: "https://evil.example" } })).rejects.toThrow();
  });

  it("refuse un aud different du client_id", async () => {
    await expect(runCallback({ claimsOverrides: { aud: "un-autre-client" } })).rejects.toThrow();
  });

  it("refuse un jeton expire", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(
      runCallback({ claimsOverrides: { iat: now - 7200, exp: now - 3600 } })
    ).rejects.toThrow();
  });

  it("refuse un nonce qui ne correspond pas a celui attendu", async () => {
    await expect(runCallback({ expectedNonceOverride: "un-autre-nonce" })).rejects.toThrow();
  });

  it("refuse un state qui ne correspond pas a celui attendu", async () => {
    await expect(runCallback({ expectedStateOverride: "un-autre-state" })).rejects.toThrow();
  });

  it("refuse email_verified=false", async () => {
    await expect(runCallback({ claimsOverrides: { email_verified: false } })).rejects.toThrow(
      GoogleAuthError
    );
  });

  it("refuse l'absence d'email_verified", async () => {
    const claims = defaultClaims();
    delete claims.email_verified;
    await expect(
      (async () => {
        const codeVerifier = client.randomPKCECodeVerifier();
        const state = client.randomState();
        const nonce = client.randomNonce();
        await idp.setNextIdToken({ ...claims, nonce });
        const currentUrl = new URL(REDIRECT_URI);
        currentUrl.searchParams.set("code", "fake-authorization-code");
        currentUrl.searchParams.set("state", state);
        return verifyGoogleCallback(
          config,
          currentUrl,
          { codeVerifier, expectedState: state, expectedNonce: nonce },
          ALLOWED_DOMAIN
        );
      })()
    ).rejects.toThrow(GoogleAuthError);
  });

  it("refuse hd different du domaine attendu", async () => {
    await expect(
      runCallback({ claimsOverrides: { hd: "autre-domaine.ma" } })
    ).rejects.toThrow(GoogleAuthError);
  });

  it("refuse l'absence de hd, MEME SI l'email a le bon suffixe (preuve qu'il n'y a pas de repli sur le suffixe)", async () => {
    const claims = defaultClaims({ email: `quelqu-un@${ALLOWED_DOMAIN}` });
    delete claims.hd;
    const codeVerifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    await idp.setNextIdToken({ ...claims, nonce });
    const currentUrl = new URL(REDIRECT_URI);
    currentUrl.searchParams.set("code", "fake-authorization-code");
    currentUrl.searchParams.set("state", state);

    await expect(
      verifyGoogleCallback(
        config,
        currentUrl,
        { codeVerifier, expectedState: state, expectedNonce: nonce },
        ALLOWED_DOMAIN
      )
    ).rejects.toThrow(GoogleAuthError);
  });
});
