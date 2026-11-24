/*
 * Faux fournisseur d'identite OIDC, HTTP local (pas TLS - allowInsecureRequests
 * cote client, jamais possible hors test). Sert UNIQUEMENT a prouver que
 * src/auth/google-oidc.ts verifie reellement ce qu'il pretend verifier,
 * jeton par jeton, par execution - pas par lecture du code.
 */
import { createServer } from "http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const ALG = "RS256";
const KID = "fake-idp-key-1";

export async function startFakeGoogleIdp() {
  const { publicKey, privateKey } = await generateKeyPair(ALG);
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = KID;
  publicJwk.alg = ALG;
  publicJwk.use = "sig";

  let nextIdTokenClaims = null;
  let signingKeyOverride = null; // pour le cas "mauvaise signature"

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          issuer: issuerUrl(),
          authorization_endpoint: `${issuerUrl()}/authorize`,
          token_endpoint: `${issuerUrl()}/token`,
          jwks_uri: `${issuerUrl()}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: [ALG],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        })
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/jwks") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/token") {
      if (!nextIdTokenClaims) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "server_error", error_description: "aucun id_token configure" }));
        return;
      }
      const keyToSignWith = signingKeyOverride ?? privateKey;
      const idToken = await new SignJWT(nextIdTokenClaims)
        .setProtectedHeader({ alg: ALG, kid: KID })
        .sign(keyToSignWith);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "fake-access-token",
          id_token: idToken,
          token_type: "Bearer",
          expires_in: 3600,
        })
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  function issuerUrl() {
    const { port } = server.address();
    return `http://127.0.0.1:${port}`;
  }

  return {
    get issuerUrl() {
      return new URL(issuerUrl());
    },
    /*
     * claims : objet fusionne dans le JWT signe par le prochain appel au
     * token endpoint. badSignature : true signe avec une AUTRE cle,
     * jamais publiee dans /jwks - reproduit une vraie signature invalide,
     * pas une simulation.
     */
    async setNextIdToken(claims, { badSignature = false } = {}) {
      nextIdTokenClaims = claims;
      if (badSignature) {
        const otherKeyPair = await generateKeyPair(ALG);
        signingKeyOverride = otherKeyPair.privateKey;
      } else {
        signingKeyOverride = null;
      }
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
