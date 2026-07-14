import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createConnectLinkReplayGuard,
  extractConnectLinkToken,
  verifyConnectLinkToken,
  verifyConnectLinkUrl,
} from "./connect-link.mjs";

const NOW = 1_783_000_000;
const KID = "owc-test";
const { publicKey: publicKeyPem, privateKey: privateKeyPem } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const publicKeys = { [KID]: publicKeyPem };

function claims(overrides = {}) {
  return {
    iss: "https://api.openwork.acme.example.com",
    aud: "openwork-desktop-connect",
    iat: NOW,
    exp: NOW + 72 * 3600,
    jti: "test-jti-0001",
    v: 1,
    org: { name: "Acme Robotics" },
    brand: { appName: "Acme Work", logoUrl: null, iconUrl: null },
    den: {
      baseUrl: "https://openwork.acme.example.com",
      apiBaseUrl: "https://api.openwork.acme.example.com",
    },
    requireSignin: true,
    ...overrides,
  };
}

/**
 * @param {Record<string, unknown>} payload
 * @param {Record<string, unknown>} [header]
 */
function mint(payload, header = { alg: "EdDSA", typ: "JWT", kid: KID }) {
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = sign(null, Buffer.from(signingInput), createPrivateKey(privateKeyPem));
  return `${signingInput}.${signature.toString("base64url")}`;
}

function verifyAt(token, nowEpochSeconds = NOW, extra = {}) {
  return verifyConnectLinkToken({ token, publicKeys, nowEpochSeconds, ...extra });
}

/** @param {import("@openwork/types/connect-link").ConnectLinkVerifyResult} result */
function failureOf(result) {
  assert.equal(result.ok, false);
  if (result.ok !== false) throw new Error("expected a failure result");
  return result;
}

test("extracts only dedicated desktop connect links", () => {
  assert.equal(extractConnectLinkToken("openwork://connect?token=a.b.c"), "a.b.c");
  assert.equal(extractConnectLinkToken("openwork-dev://connect?token=a.b.c"), "a.b.c");
  assert.equal(extractConnectLinkToken("openwork:///connect?token=a.b.c"), "a.b.c");
  assert.equal(extractConnectLinkToken("openwork://den-auth?grant=x"), null);
  assert.equal(extractConnectLinkToken("https://connect?token=a.b.c"), null);
});

test("verifies an exact signed organization target end to end", () => {
  const expected = claims();
  const token = mint(expected);
  const result = verifyConnectLinkUrl(
    `openwork://connect?token=${encodeURIComponent(token)}`,
    { publicKeys, nowEpochSeconds: NOW },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.claims, expected);
  assert.equal(result.kid, KID);
});

test("rejects tampering, algorithm confusion, and unknown keys", () => {
  const token = mint(claims());
  const [header, , signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify(claims({
    den: { baseUrl: "https://evil.example.com" },
  }))).toString("base64url");
  assert.equal(failureOf(verifyAt(`${header}.${forged}.${signature}`)).code, "bad_signature");

  for (const invalidHeader of [
    { alg: "none", kid: KID },
    { alg: "HS256", kid: KID },
    { alg: "EdDSA", kid: KID, crit: ["exp"] },
  ]) {
    assert.equal(verifyAt(mint(claims(), invalidHeader)).ok, false);
  }
  assert.equal(failureOf(verifyAt(mint(claims(), { alg: "EdDSA", kid: "other" }))).code, "unknown_kid");
});

test("enforces time and HTTPS policies", () => {
  const token = mint(claims());
  assert.equal(verifyAt(token, NOW + 72 * 3600 + 30).ok, true);
  assert.equal(failureOf(verifyAt(token, NOW + 72 * 3600 + 61)).code, "expired");
  assert.equal(failureOf(verifyAt(token, NOW - 61)).code, "not_yet_valid");

  const intranet = mint(claims({ den: { baseUrl: "http://intranet.example.com" } }));
  assert.equal(failureOf(verifyAt(intranet, NOW, { allowInsecureLoopback: true })).code, "insecure_url");
  const loopback = mint(claims({ den: { baseUrl: "http://127.0.0.1:8790" } }));
  assert.equal(verifyAt(loopback).ok, false);
  assert.equal(verifyAt(loopback, NOW, { allowInsecureLoopback: true }).ok, true);
});

test("replay guard is persistent, atomic, and bounded", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "connect-link-test-"));
  const filePath = path.join(dir, "seen.json");
  const guard = createConnectLinkReplayGuard({ filePath });
  assert.equal(await guard.remember("jti-1"), true);
  assert.equal(await guard.remember("jti-1"), false);

  const reloaded = createConnectLinkReplayGuard({ filePath });
  assert.equal(await reloaded.has("jti-1"), true);
  const concurrent = await Promise.all([
    reloaded.remember("jti-concurrent"),
    reloaded.remember("jti-concurrent"),
  ]);
  assert.deepEqual(concurrent.sort(), [false, true]);

  for (let index = 0; index < 520; index += 1) {
    await reloaded.remember(`jti-fill-${index}`);
  }
  const persisted = JSON.parse(await readFile(filePath, "utf8"));
  assert.ok(persisted.length <= 512);
});
