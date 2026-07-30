import { describe, expect, test } from "bun:test";

import {
  EMPTY_ELEVATED_DEVELOPER_MODE_TOGGLE_SEQUENCE,
  ELEVATED_DEVELOPER_MODE_TOGGLE_WINDOW_MS,
  recordElevatedDeveloperModeToggle,
} from "../src/app/lib/elevated-developer-mode";

describe("elevated Developer mode gesture", () => {
  test("triggers on the fifth rapid Developer mode toggle", () => {
    let sequence = EMPTY_ELEVATED_DEVELOPER_MODE_TOGGLE_SEQUENCE;

    for (let index = 0; index < 4; index += 1) {
      const result = recordElevatedDeveloperModeToggle(sequence, 1_000 + index);
      expect(result.triggered).toBe(false);
      sequence = result.sequence;
    }

    const result = recordElevatedDeveloperModeToggle(sequence, 1_004);
    expect(result.triggered).toBe(true);
    expect(result.sequence).toEqual(
      EMPTY_ELEVATED_DEVELOPER_MODE_TOGGLE_SEQUENCE,
    );
  });

  test("restarts the gesture after the toggle window expires", () => {
    const first = recordElevatedDeveloperModeToggle(
      EMPTY_ELEVATED_DEVELOPER_MODE_TOGGLE_SEQUENCE,
      1_000,
    );
    const expired = recordElevatedDeveloperModeToggle(
      first.sequence,
      1_000 + ELEVATED_DEVELOPER_MODE_TOGGLE_WINDOW_MS + 1,
    );

    expect(expired).toEqual({
      sequence: {
        count: 1,
        startedAt: 1_000 + ELEVATED_DEVELOPER_MODE_TOGGLE_WINDOW_MS + 1,
      },
      triggered: false,
    });
  });
});
