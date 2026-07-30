export const ELEVATED_DEVELOPER_MODE_TOGGLE_COUNT = 5;
export const ELEVATED_DEVELOPER_MODE_TOGGLE_WINDOW_MS = 8_000;

export type ElevatedDeveloperModeToggleSequence = {
  count: number;
  startedAt: number | null;
};

export const EMPTY_ELEVATED_DEVELOPER_MODE_TOGGLE_SEQUENCE: ElevatedDeveloperModeToggleSequence = {
  count: 0,
  startedAt: null,
};

export function recordElevatedDeveloperModeToggle(
  sequence: ElevatedDeveloperModeToggleSequence,
  now = Date.now(),
): {
  sequence: ElevatedDeveloperModeToggleSequence;
  triggered: boolean;
} {
  const sequenceExpired =
    sequence.startedAt === null ||
    now < sequence.startedAt ||
    now - sequence.startedAt > ELEVATED_DEVELOPER_MODE_TOGGLE_WINDOW_MS;
  const nextCount = sequenceExpired ? 1 : sequence.count + 1;

  if (nextCount >= ELEVATED_DEVELOPER_MODE_TOGGLE_COUNT) {
    return {
      sequence: EMPTY_ELEVATED_DEVELOPER_MODE_TOGGLE_SEQUENCE,
      triggered: true,
    };
  }

  return {
    sequence: {
      count: nextCount,
      startedAt: sequenceExpired ? now : sequence.startedAt,
    },
    triggered: false,
  };
}
