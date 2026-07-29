import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { ReactSessionRuntime } = await import("../src/react-app/domains/session/sync/runtime-sync");
const {
  __applySessionSyncEventForTest,
  __disposeWorkspaceSessionSyncForTest,
  __setWorkspaceSessionSyncSubscriptionFactoryForTest,
} = await import("../src/react-app/domains/session/sync/session-sync");

const syncInput = {
  workspaceId: "ws_shared",
  baseUrl: "https://one.example/opencode",
  openworkToken: "token",
};
const subscriptionSignals: AbortSignal[] = [];

async function createSubscription(_baseUrl: string, _token: string, signal: AbortSignal) {
  let end = () => {};
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  signal.addEventListener("abort", end, { once: true });
  async function* stream() {
    await ended;
  }
  subscriptionSignals.push(signal);
  return stream();
}

afterEach(() => {
  __disposeWorkspaceSessionSyncForTest(syncInput);
  __setWorkspaceSessionSyncSubscriptionFactoryForTest(null);
  subscriptionSignals.length = 0;
});

describe("ReactSessionRuntime", () => {
  test("does not re-subscribe for equivalent session ids and fresh callbacks", async () => {
    const firstDeleted: string[] = [];
    const secondDeleted: string[] = [];
    let renderer: ReactTestRenderer | undefined;
    __setWorkspaceSessionSyncSubscriptionFactoryForTest(createSubscription);

    await act(async () => {
      renderer = create(<ReactSessionRuntime
        workspaceId="ws_shared"
        sessionId={null}
        activeSessionIds={[]}
        opencodeBaseUrl={syncInput.baseUrl}
        openworkToken={syncInput.openworkToken}
        onSessionDeleted={(sessionId) => firstDeleted.push(sessionId)}
      />);
    });

    await act(async () => {
      renderer?.update(<ReactSessionRuntime
        workspaceId={syncInput.workspaceId}
        sessionId={null}
        activeSessionIds={[]}
        opencodeBaseUrl={syncInput.baseUrl}
        openworkToken={syncInput.openworkToken}
        onSessionDeleted={(sessionId) => secondDeleted.push(sessionId)}
      />);
    });

    expect(subscriptionSignals).toHaveLength(1);
    __applySessionSyncEventForTest(syncInput, {
      type: "session.deleted",
      properties: { sessionID: "ses_deleted" },
    });
    expect(firstDeleted).toEqual([]);
    expect(secondDeleted).toEqual(["ses_deleted"]);

    await act(async () => {
      renderer?.unmount();
    });
  });
});
