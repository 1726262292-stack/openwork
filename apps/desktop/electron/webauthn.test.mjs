import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  configureMacosTouchIdPasskeys,
  macosWebAuthnKeychainAccessGroup,
} from "./webauthn.mjs";

describe("macOS WebAuthn", () => {
  it("derives the Touch ID keychain group from the signing team and bundle", () => {
    assert.equal(
      macosWebAuthnKeychainAccessGroup({
        teamId: "F5DJWB4CCV",
        bundleId: "com.differentai.openwork",
      }),
      "F5DJWB4CCV.com.differentai.openwork.webauthn",
    );
  });

  it("configures Touch ID with user-facing prompt copy", () => {
    const calls = [];
    assert.equal(configureMacosTouchIdPasskeys({
      electronApp: { configureWebAuthn: (options) => calls.push(options) },
      platform: "darwin",
      keychainAccessGroup: "F5DJWB4CCV.com.differentai.openwork.webauthn",
    }), true);
    assert.deepEqual(calls, [{
      touchID: {
        keychainAccessGroup: "F5DJWB4CCV.com.differentai.openwork.webauthn",
        promptReason: "sign in to $1",
      },
    }]);
  });

  it("does nothing when the platform or Electron capability is unsupported", () => {
    assert.equal(configureMacosTouchIdPasskeys({
      electronApp: { configureWebAuthn: () => assert.fail("must not be called") },
      platform: "linux",
      keychainAccessGroup: "group",
    }), false);
    assert.equal(configureMacosTouchIdPasskeys({
      electronApp: {},
      platform: "darwin",
      keychainAccessGroup: "group",
    }), false);
  });

  it("does not interrupt startup when Touch ID cannot be configured", () => {
    assert.doesNotThrow(() => configureMacosTouchIdPasskeys({
      electronApp: { configureWebAuthn: () => { throw new Error("unavailable"); } },
      platform: "darwin",
      keychainAccessGroup: "group",
    }));
  });
});
