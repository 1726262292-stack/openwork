declare const describe: (name: string, fn: () => void) => void;
declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toEqual: (expected: unknown) => void;
};

import { compareProviderTiers } from "./providers";

const providers = [
  { id: "opencode", name: "OpenCode Zen" },
  { id: "openwork", name: "OpenWork Models" },
  { id: "z-local", name: "Zeta" },
  { id: "a-local", name: "Alpha" },
  { id: "lpr_z", name: "Org Zeta" },
  { id: "LPR_a", name: "Org Alpha" },
];

describe("compareProviderTiers", () => {
  test("orders organization-shared, custom, openwork, then other providers alphabetically within tiers", () => {
    expect(
      [...providers]
        .sort((a, b) => compareProviderTiers(a, b, { hasOnlyManagedFallback: false }))
        .map((provider) => provider.id),
    ).toEqual(["LPR_a", "lpr_z", "a-local", "z-local", "openwork", "opencode"]);
  });

  test("puts OpenWork Models first when only managed fallback providers are available", () => {
    const fallbackProviders = providers.filter((provider) =>
      provider.id === "openwork" || provider.id === "opencode"
    );
    expect(
      fallbackProviders
        .sort((a, b) => compareProviderTiers(a, b, { hasOnlyManagedFallback: true }))
        .map((provider) => provider.id),
    ).toEqual(["openwork", "opencode"]);
  });
});
