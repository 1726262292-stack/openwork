import { expect, test } from "bun:test";
import {
  buildLibraryModelTiles,
  OPENWORK_MODEL_LABELS,
} from "../app/(den)/dashboard/_components/library-models-data";
import type {
  DenLlmProvider,
} from "../app/(den)/dashboard/_components/llm-provider-data";

function provider(
  overrides: Partial<DenLlmProvider> & Pick<DenLlmProvider, "id" | "source" | "providerId" | "name">,
): DenLlmProvider {
  return {
    organizationId: "org_library_models",
    createdByOrgMembershipId: "om_library_models",
    providerConfig: {},
    hasApiKey: true,
    configuredEnvKeys: [],
    createdAt: null,
    updatedAt: null,
    canManage: false,
    accessibleVia: { orgMembershipIds: [], teamIds: [] },
    models: [],
    access: { allMembers: true, members: [], teams: [] },
    ...overrides,
  };
}

const openWork = provider({
  id: "llmp_openwork",
  source: "openwork",
  providerId: "openwork",
  name: "OpenWork Models",
});

const listed = provider({
  id: "llmp_listed",
  source: "models_dev",
  providerId: "anthropic",
  name: "Anthropic",
  models: [
    { id: "claude-a", name: "Claude A", config: {}, createdAt: null },
    { id: "claude-b", name: "Claude B", config: {}, createdAt: null },
  ],
});

const custom = provider({
  id: "llmp_custom",
  source: "custom",
  providerId: "internal-gateway",
  name: "Internal Gateway",
  models: [
    { id: "gateway-a", name: "Gateway A", config: {}, createdAt: null },
    { id: "gateway-b", name: "Gateway B", config: {}, createdAt: null },
  ],
});

test("OpenWork models lead the library models card", () => {
  // OpenWork is supplied last on purpose: ordering is the builder's job.
  const tiles = buildLibraryModelTiles([listed, custom, openWork]);
  const openWorkTiles = tiles.filter((tile) => tile.source === "openwork");

  expect(OPENWORK_MODEL_LABELS.length).toBeGreaterThan(0);
  expect(openWorkTiles.map((tile) => tile.label)).toEqual([...OPENWORK_MODEL_LABELS]);
  expect(tiles.slice(0, openWorkTiles.length).every((tile) => tile.source === "openwork")).toBe(true);
  // The card names models, so the shared "OpenWork: " prefix is stripped.
  expect(openWorkTiles.every((tile) => !tile.label.startsWith("OpenWork:"))).toBe(true);
  expect(openWorkTiles.every((tile) => tile.iconUrl === "/openwork-mark.svg")).toBe(true);
});

test("a listed provider lists each selected model separately", () => {
  const tiles = buildLibraryModelTiles([listed]);

  expect(tiles.map((tile) => tile.label)).toEqual(["Claude A", "Claude B"]);
  expect(tiles.every((tile) => tile.providerName === "Anthropic")).toBe(true);
});

test("a custom provider collapses to its configured name", () => {
  const tiles = buildLibraryModelTiles([custom]);

  expect(tiles.length).toBe(1);
  expect(tiles[0].label).toBe("Internal Gateway");
  expect(tiles.some((tile) => tile.label === "Gateway A")).toBe(false);
});

test("a provider with no usable models contributes no tiles", () => {
  const empty = provider({
    id: "llmp_empty",
    source: "models_dev",
    providerId: "openai",
    name: "Unselected OpenAI",
  });

  expect(buildLibraryModelTiles([empty])).toEqual([]);
  expect(buildLibraryModelTiles([])).toEqual([]);
});
