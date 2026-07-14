import { describe, expect, test } from "bun:test";

import {
  connectionDisplayState,
  connectionDisplayStateLabelKey,
} from "../src/react-app/domains/connections/connection-display-state";

describe("connectionDisplayState", () => {
  test("shows configured when config exists but runtime status is not observed", () => {
    expect(connectionDisplayState({ configured: true })).toBe("configured");
  });

  test("returns null when no config or runtime signal exists", () => {
    expect(connectionDisplayState({ configured: false })).toBeNull();
  });

  test("shows auth_required for auth signals", () => {
    expect(connectionDisplayState({ configured: true, status: "needs_auth" })).toBe("auth_required");
    expect(connectionDisplayState({ configured: true, status: "needs_client_registration" })).toBe("auth_required");
    expect(connectionDisplayState({ configured: true, needsAuth: true })).toBe("auth_required");
  });

  test("shows protocol_ready only after the protocol status reports connected", () => {
    expect(connectionDisplayState({ configured: true, status: "connected" })).toBe("protocol_ready");
  });

  test("shows error for failed status or failed signal", () => {
    expect(connectionDisplayState({ configured: true, status: "failed" })).toBe("error");
    expect(connectionDisplayState({ configured: true, failed: true })).toBe("error");
  });

  test("shows disabled for config or runtime disabled signals", () => {
    expect(connectionDisplayState({ configured: true, enabled: false, status: "connected" })).toBe("disabled");
    expect(connectionDisplayState({ configured: true, status: "disabled" })).toBe("disabled");
  });

  test("maps display states to static translation keys", () => {
    expect(connectionDisplayStateLabelKey("configured")).toBe("mcp.display_state_configured");
    expect(connectionDisplayStateLabelKey("auth_required")).toBe("mcp.display_state_needs_signin");
    expect(connectionDisplayStateLabelKey("protocol_ready")).toBe("mcp.display_state_ready");
    expect(connectionDisplayStateLabelKey("error")).toBe("mcp.display_state_error");
    expect(connectionDisplayStateLabelKey("disabled")).toBe("mcp.display_state_off");
  });
});
