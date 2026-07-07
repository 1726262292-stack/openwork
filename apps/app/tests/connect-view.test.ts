import { describe, expect, test } from "bun:test";

import { resolveConnectViewState } from "../src/react-app/domains/settings/pages/connect-view";

describe("resolveConnectViewState", () => {
  test("shows loading while auth is being checked", () => {
    expect(resolveConnectViewState({ authStatus: "checking", connectionsCount: 0 })).toBe("loading");
  });

  test("signed-out users see the sign-in state", () => {
    expect(resolveConnectViewState({ authStatus: "signed_out", connectionsCount: 0 })).toBe("signin");
  });

  test("signed-in users with the org Connect flag see active", () => {
    expect(resolveConnectViewState({ authStatus: "signed_in", connectEnabled: true, connectionsCount: 0 })).toBe("active");
  });

  test("signed-in users with usable org connections see active even without the flag", () => {
    expect(resolveConnectViewState({ authStatus: "signed_in", connectEnabled: false, connectionsCount: 1 })).toBe("active");
  });

  test("signed-in users with no flag and no connections see the pitch", () => {
    expect(resolveConnectViewState({ authStatus: "signed_in", connectEnabled: false, connectionsCount: 0 })).toBe("pitch");
    expect(resolveConnectViewState({ authStatus: "signed_in", connectionsCount: 0 })).toBe("pitch");
  });
});
