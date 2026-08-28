import { describe, expect, test } from "bun:test"
import {
  createInferenceBearerKey,
  INFERENCE_BEARER_KEY_RANDOM_BYTES,
  inferenceBearerKeyLookupDigest,
} from "./inference-bearer-key"

describe("inference bearer keys", () => {
  test("generates unique bearer secrets from 256 bits of CSPRNG output", () => {
    const keys = Array.from({ length: 32 }, () => createInferenceBearerKey())

    expect(new Set(keys.map((key) => key.value)).size).toBe(keys.length)
    for (const key of keys) {
      expect(key.purpose).toBe("inference-bearer-key")
      expect(key.value).toMatch(/^ow_inf_[A-Za-z0-9_-]+$/)
      expect(Buffer.from(key.value.slice("ow_inf_".length), "base64url")).toHaveLength(INFERENCE_BEARER_KEY_RANDOM_BYTES)
    }
  })

  test("uses a deterministic SHA-256 lookup digest without retaining the bearer value", () => {
    const key = createInferenceBearerKey()
    const digest = inferenceBearerKeyLookupDigest(key)

    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).toBe(inferenceBearerKeyLookupDigest(key))
    expect(digest).not.toContain(key.value)
  })
})
