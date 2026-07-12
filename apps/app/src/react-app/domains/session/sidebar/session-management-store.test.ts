declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
};

import {
  isSessionUnreadForReadWatermarks,
  markSessionReadInWatermarks,
  seedSessionReadWatermarksForWorkspace,
  type SessionReadWatermarkSource,
} from "./session-management-store";

const WORKSPACE_ID = "workspace-1";

function session(id: string, updated: number, created?: number): SessionReadWatermarkSource {
  return { id, time: { updated, created } };
}

describe("session read watermarks", () => {
  test("seeds existing sessions at their current timestamps", () => {
    const seeded = seedSessionReadWatermarksForWorkspace({}, WORKSPACE_ID, [
      session("session-a", 1000),
      session("session-b", 2000),
    ]);

    expect(seeded).toEqual({
      [WORKSPACE_ID]: {
        "session-a": 1000,
        "session-b": 2000,
      },
    });
    expect(isSessionUnreadForReadWatermarks(seeded[WORKSPACE_ID] ?? {}, session("session-a", 1000), null)).toBe(false);
  });

  test("marks a background session unread after its update timestamp advances", () => {
    const seeded = seedSessionReadWatermarksForWorkspace({}, WORKSPACE_ID, [session("session-a", 1000)]);

    expect(isSessionUnreadForReadWatermarks(seeded[WORKSPACE_ID] ?? {}, session("session-a", 1000), null)).toBe(false);
    expect(isSessionUnreadForReadWatermarks(seeded[WORKSPACE_ID] ?? {}, session("session-a", 1500), null)).toBe(true);
    expect(isSessionUnreadForReadWatermarks(seeded[WORKSPACE_ID] ?? {}, session("session-a", 1500), "session-a")).toBe(false);
  });

  test("opening a session advances its watermark and clears unread", () => {
    const seeded = seedSessionReadWatermarksForWorkspace({}, WORKSPACE_ID, [session("session-a", 1000)]);
    const updatedSession = session("session-a", 1500);
    const markedRead = markSessionReadInWatermarks(seeded, WORKSPACE_ID, updatedSession);

    expect(markedRead).toEqual({ [WORKSPACE_ID]: { "session-a": 1500 } });
    expect(isSessionUnreadForReadWatermarks(markedRead[WORKSPACE_ID] ?? {}, updatedSession, null)).toBe(false);
  });
});
