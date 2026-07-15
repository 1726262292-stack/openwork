import { describe, expect, test } from "bun:test";

import { hasOpenWorkModelsProvider } from "../src/react-app/domains/cloud/openwork-models-promo";

describe("hasOpenWorkModelsProvider", () => {
  test("true for the OpenWork Models provider", () => {
    expect(hasOpenWorkModelsProvider(["openai", "openwork"])).toBe(true);
    expect(hasOpenWorkModelsProvider([" OpenWork "])).toBe(true);
  });

  test("true for org-managed cloud providers so members are never pitched a subscription", () => {
    expect(hasOpenWorkModelsProvider(["lpr_evalorg"])).toBe(true);
    expect(hasOpenWorkModelsProvider(["opencode", "LPR_ACME"])).toBe(true);
  });

  test("false without hosted models", () => {
    expect(hasOpenWorkModelsProvider([])).toBe(false);
    expect(hasOpenWorkModelsProvider(["openai", "opencode", "anthropic"])).toBe(false);
  });
});
