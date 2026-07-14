import { describe, expect, test } from "bun:test";

import { shouldPollTelegramConnection } from "../app/(den)/dashboard/_components/telegram-dialog";

describe("Telegram dialog polling", () => {
  test("does not poll for closed, null, errored, or paired states", () => {
    expect(shouldPollTelegramConnection({ open: false, queryErrored: false, connection: { pairing: { paired: false } } })).toBe(false);
    expect(shouldPollTelegramConnection({ open: true, queryErrored: false, connection: null })).toBe(false);
    expect(shouldPollTelegramConnection({ open: true, queryErrored: true, connection: { pairing: { paired: false } } })).toBe(false);
    expect(shouldPollTelegramConnection({ open: true, queryErrored: false, connection: { pairing: { paired: true } } })).toBe(false);
  });

  test("polls only for a successfully loaded unpaired connection", () => {
    expect(shouldPollTelegramConnection({ open: true, queryErrored: false, connection: { pairing: { paired: false } } })).toBe(true);
  });
});
