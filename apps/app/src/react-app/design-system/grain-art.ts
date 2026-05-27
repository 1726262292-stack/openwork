import type { ExtensionKind } from "../../app/constants";

export type GrainArtCategory = "workspaces" | "skills" | "mcps" | "plugins" | "extension" | "fallback";

const GRAIN_ART_COUNT = 32;

function hashSeed(input: string): number {
  const value = input.trim() || "openwork";
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function categoryPrefix(category: GrainArtCategory) {
  return category;
}

export function grainArtSrc(category: GrainArtCategory, seed: string) {
  const index = (hashSeed(`${category}:${seed}`) % GRAIN_ART_COUNT) + 1;
  const padded = String(index).padStart(3, "0");
  return `${import.meta.env.BASE_URL}grain-art/${category}/${categoryPrefix(category)}-${padded}.png`;
}

export function grainArtCategoryForExtensionKind(kind: ExtensionKind): GrainArtCategory {
  switch (kind) {
    case "skill":
      return "skills";
    case "mcp":
      return "mcps";
    case "plugin":
      return "plugins";
    case "extension":
    case "ui-control":
      return "extension";
  }
}
