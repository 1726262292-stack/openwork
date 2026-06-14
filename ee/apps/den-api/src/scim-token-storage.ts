import { Buffer } from "node:buffer"
import { createHash, timingSafeEqual } from "node:crypto"

export const SCIM_TOKEN_STORAGE_STRATEGY = "hashed"

export function hashScimToken(scimToken: string) {
  return createHash("sha256").update(scimToken).digest("base64url")
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBytes = Uint8Array.from(Buffer.from(left))
  const rightBytes = Uint8Array.from(Buffer.from(right))
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export function getStoredScimTokenVerification(input: {
  storedToken: string
  rawToken: string
}) {
  const expectedToken = hashScimToken(input.rawToken)
  if (timingSafeStringEqual(input.storedToken, expectedToken)) {
    return { ok: true, needsRehash: false }
  }
  if (timingSafeStringEqual(input.storedToken, input.rawToken)) {
    return { ok: true, needsRehash: true }
  }
  return { ok: false, needsRehash: false }
}

export function verifyStoredScimToken(input: {
  storedToken: string
  rawToken: string
}) {
  return getStoredScimTokenVerification(input).ok
}
