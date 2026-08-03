export const MACOS_WEBAUTHN_PROMPT_REASON = "sign in to $1";

export function macosWebAuthnKeychainAccessGroup({ teamId, bundleId }) {
  if (typeof teamId !== "string" || !teamId.trim()) return null;
  if (typeof bundleId !== "string" || !bundleId.trim()) return null;
  return `${teamId.trim()}.${bundleId.trim()}.webauthn`;
}

export function configureMacosTouchIdPasskeys({
  electronApp,
  platform,
  keychainAccessGroup,
}) {
  if (platform !== "darwin" || typeof electronApp?.configureWebAuthn !== "function") {
    return false;
  }
  if (typeof keychainAccessGroup !== "string" || !keychainAccessGroup) return false;

  try {
    electronApp.configureWebAuthn({
      touchID: {
        keychainAccessGroup,
        promptReason: MACOS_WEBAUTHN_PROMPT_REASON,
      },
    });
    return true;
  } catch {
    // Macs without a Secure Enclave cannot use Touch ID passkeys. Leave the
    // browser's capability probe false without interrupting app startup.
    return false;
  }
}
