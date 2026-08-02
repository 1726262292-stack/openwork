"use client";

import { useQuery } from "@tanstack/react-query";

import { getErrorMessage, requestJson } from "../../_lib/den-flow";
import type { PluginAccessRole } from "./plugin-access-data";

type LibraryNamedEntity = {
  id: string;
  name: string;
};

type LibraryMemberEntity = {
  orgMembershipId: string;
  name: string;
};

export type LibraryAccessEdge =
  | { kind: "mine" }
  | { kind: "person"; sharedBy: LibraryMemberEntity | null; grantedAt: string }
  | { kind: "team"; team: LibraryNamedEntity }
  | { kind: "org_wide" }
  | { kind: "catalog"; marketplace: LibraryNamedEntity };

export type LibraryPluginAccessItem = {
  plugin: {
    id: string;
    name: string;
    description: string | null;
    componentCount: number;
    sourceRepositoryUrl: string | null;
  };
  edges: LibraryAccessEdge[];
  role: PluginAccessRole;
};

export const libraryQueryKeys = {
  access: ["me", "plugin-access"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return readString(value) ?? undefined;
}

function readRole(value: unknown): PluginAccessRole | null {
  if (value === "viewer" || value === "editor" || value === "manager") return value;
  return null;
}

function parseNamedEntity(value: unknown): LibraryNamedEntity | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const name = readString(value.name);
  return id && name ? { id, name } : null;
}

function parseMemberEntity(value: unknown): LibraryMemberEntity | null {
  if (!isRecord(value)) return null;
  const orgMembershipId = readString(value.orgMembershipId);
  const name = readString(value.name);
  return orgMembershipId && name ? { orgMembershipId, name } : null;
}

function parseEdge(value: unknown): LibraryAccessEdge | null {
  if (!isRecord(value)) return null;
  if (value.kind === "mine" || value.kind === "org_wide") {
    return { kind: value.kind };
  }
  if (value.kind === "person") {
    const sharedBy = value.sharedBy === null ? null : parseMemberEntity(value.sharedBy);
    const grantedAt = readString(value.grantedAt);
    if (sharedBy === null && value.sharedBy !== null) return null;
    return grantedAt ? { kind: "person", sharedBy, grantedAt } : null;
  }
  if (value.kind === "team") {
    const team = parseNamedEntity(value.team);
    return team ? { kind: "team", team } : null;
  }
  if (value.kind === "catalog") {
    const marketplace = parseNamedEntity(value.marketplace);
    return marketplace ? { kind: "catalog", marketplace } : null;
  }
  return null;
}

function parseLibraryItem(value: unknown): LibraryPluginAccessItem | null {
  if (!isRecord(value) || !isRecord(value.plugin) || !Array.isArray(value.edges)) return null;
  const id = readString(value.plugin.id);
  const name = readString(value.plugin.name);
  const description = readNullableString(value.plugin.description);
  const sourceRepositoryUrl = readNullableString(value.plugin.sourceRepositoryUrl);
  const componentCount = value.plugin.componentCount;
  const role = readRole(value.role);
  const edges = value.edges.map(parseEdge).filter((edge): edge is LibraryAccessEdge => edge !== null);
  if (
    !id
    || !name
    || description === undefined
    || sourceRepositoryUrl === undefined
    || typeof componentCount !== "number"
    || !Number.isInteger(componentCount)
    || componentCount < 0
    || !role
    || edges.length !== value.edges.length
  ) {
    return null;
  }
  return {
    plugin: {
      id,
      name,
      description,
      componentCount,
      sourceRepositoryUrl,
    },
    edges,
    role,
  };
}

export function parseLibraryPayload(payload: unknown): LibraryPluginAccessItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error("Plugin access response was incomplete.");
  }
  const items = payload.items
    .map(parseLibraryItem)
    .filter((item): item is LibraryPluginAccessItem => item !== null);
  if (items.length !== payload.items.length) {
    throw new Error("Plugin access response was incomplete.");
  }
  return items;
}

export function useLibraryAccess() {
  return useQuery({
    queryKey: libraryQueryKeys.access,
    queryFn: async (): Promise<LibraryPluginAccessItem[]> => {
      const { response, payload } = await requestJson(
        "/v1/me/plugin-access",
        { method: "GET" },
        15000,
      );
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `Failed to load library (${response.status}).`));
      }
      return parseLibraryPayload(payload);
    },
  });
}
