import { createHash, randomBytes } from "node:crypto"

export const INFERENCE_BEARER_KEY_RANDOM_BYTES = 32
const INFERENCE_BEARER_KEY_PREFIX = "ow_inf_"

export type InferenceBearerKey = Readonly<{
  purpose: "inference-bearer-key"
  value: string
}>

export function inferenceBearerKey(value: string): InferenceBearerKey {
  return { purpose: "inference-bearer-key", value }
}

export function createInferenceBearerKey(): InferenceBearerKey {
  return inferenceBearerKey(`${INFERENCE_BEARER_KEY_PREFIX}${randomBytes(INFERENCE_BEARER_KEY_RANDOM_BYTES).toString("base64url")}`)
}

/** Fast database lookup digest for a CSPRNG-generated 256-bit bearer key, not a password hash. */
export function inferenceBearerKeyLookupDigest(key: InferenceBearerKey): string {
  return createHash("sha256").update(key.value).digest("hex")
}

export function inferenceBearerKeyPrefix(key: InferenceBearerKey): string {
  return key.value.slice(0, 16)
}
