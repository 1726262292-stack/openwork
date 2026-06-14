import { expect, test } from "bun:test"
import {
  getStoredScimTokenVerification,
  hashScimToken,
  SCIM_TOKEN_STORAGE_STRATEGY,
  verifyStoredScimToken,
} from "../src/scim-token-storage.js"

test("SCIM token storage uses Better Auth compatible hashed storage", () => {
  expect(SCIM_TOKEN_STORAGE_STRATEGY).toBe("hashed")
  expect(hashScimToken("scim-test-token")).toBe("ai6yKWtx5P0IDcrGT0DoX6GiKMx85Q42b0UVBmL8usE")
})

test("SCIM token verification compares the stored hash in constant time", () => {
  const storedToken = hashScimToken("scim-test-token")
  expect(verifyStoredScimToken({ storedToken, rawToken: "scim-test-token" })).toBe(true)
  expect(verifyStoredScimToken({ storedToken, rawToken: "wrong-token" })).toBe(false)
})

test("SCIM token verification accepts legacy plaintext tokens for migration", () => {
  expect(getStoredScimTokenVerification({
    storedToken: "legacy-scim-token",
    rawToken: "legacy-scim-token",
  })).toEqual({ ok: true, needsRehash: true })
})
