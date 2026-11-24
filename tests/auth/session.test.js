/*
 * src/auth/session.ts n'avait aucun test - signale par relecture
 * independante avant de considerer la Phase 3 terminee. Verifie ici les
 * exigences explicites du directeur de projet : options de cookie
 * (httpOnly, sameSite strict pour la session / lax pour le flux de
 * login, secure), forme du contenu scelle (userId seul, jamais un jeton),
 * et le comportement sur sceau invalide/avec le mauvais mot de passe
 * (doit redevenir "pas de session", jamais une erreur ni un id invente).
 */
import { describe, it, expect } from "vitest";
import { randomBytes } from "crypto";
import {
  sessionCookieOptions,
  loginFlowCookieOptions,
  createSessionCookieValue,
  readSessionCookieValue,
  createLoginFlowCookieValue,
  readLoginFlowCookieValue,
} from "../../src/auth/session.ts";

function randomPassword() {
  return randomBytes(32).toString("hex");
}

describe("sessionCookieOptions / loginFlowCookieOptions", () => {
  it("session : httpOnly, sameSite strict, path /", () => {
    expect(sessionCookieOptions(true)).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
  });

  it("session : secure suit le parametre, jamais deduit implicitement", () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
    expect(sessionCookieOptions(false).secure).toBe(false);
  });

  it("flux de login : sameSite lax (pas strict - doit survivre la redirection depuis Google)", () => {
    expect(loginFlowCookieOptions(true)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });
});

describe("session - scellement/descellement", () => {
  it("le contenu scelle ne contient que userId - round-trip exact", async () => {
    const password = randomPassword();
    const seal = await createSessionCookieValue({ userId: "user-abc" }, password);
    const data = await readSessionCookieValue(seal, password);
    expect(data).toEqual({ userId: "user-abc" });
  });

  it("un sceau altere redevient null, pas une erreur", async () => {
    const password = randomPassword();
    const seal = await createSessionCookieValue({ userId: "user-abc" }, password);
    const tampered = seal.slice(0, -4) + "xxxx";
    const data = await readSessionCookieValue(tampered, password);
    expect(data).toBeNull();
  });

  it("le mauvais mot de passe redevient null, pas une erreur ni l'id original", async () => {
    const seal = await createSessionCookieValue({ userId: "user-abc" }, randomPassword());
    const data = await readSessionCookieValue(seal, randomPassword());
    expect(data).toBeNull();
  });

  it("un sceau de session ne se descelle PAS avec le mot de passe du flux de login (mots de passe separes)", async () => {
    const sessionPassword = randomPassword();
    const loginFlowPassword = randomPassword();
    const seal = await createSessionCookieValue({ userId: "user-abc" }, sessionPassword);
    const data = await readLoginFlowCookieValue(seal, loginFlowPassword);
    expect(data).toBeNull();
  });
});

describe("flux de login - scellement/descellement", () => {
  it("round-trip exact sur les 4 champs", async () => {
    const password = randomPassword();
    const payload = {
      codeVerifier: "verifier-abc",
      state: "state-abc",
      nonce: "nonce-abc",
      redirectUri: "http://localhost/callback",
    };
    const seal = await createLoginFlowCookieValue(payload, password);
    const data = await readLoginFlowCookieValue(seal, password);
    expect(data).toEqual(payload);
  });

  it("un payload de forme differente (session, pas flux de login) redevient null, jamais un objet partiel", async () => {
    const password = randomPassword();
    const seal = await createSessionCookieValue({ userId: "pas-un-flux-de-login" }, password);
    const data = await readLoginFlowCookieValue(seal, password);
    expect(data).toBeNull();
  });
});
