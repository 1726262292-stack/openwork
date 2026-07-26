"use client";

import { useQuery } from "@tanstack/react-query";
import { parseSkillMarkdown, yamlValue } from "@openwork-ee/utils";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";

export type DenSkill = {
  id: string;
  name: string;
  description: string;
  body: string;
  rawSourceText: string;
  sourceMode: "cloud" | "connector" | "local";
  updatedAt: string;
};

export const skillQueryKeys = {
  all: ["skills"] as const,
  list: () => [...skillQueryKeys.all, "list"] as const,
  detail: (id: string) => [...skillQueryKeys.all, "detail", id] as const,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseDenSkill(value: unknown): DenSkill | null {
  if (!isRecord(value) || value.objectType !== "skill" || !isRecord(value.latestVersion)) return null;
  const id = typeof value.id === "string" ? value.id : null;
  const rawSourceText = typeof value.latestVersion.rawSourceText === "string" ? value.latestVersion.rawSourceText : null;
  const sourceMode = value.sourceMode === "cloud" || value.sourceMode === "connector" || value.sourceMode === "local"
    ? value.sourceMode
    : null;
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : null;
  if (!id || rawSourceText === null || !sourceMode || !updatedAt) return null;

  const parsed = parseSkillMarkdown(rawSourceText);
  return {
    body: parsed.body,
    description: parsed.description,
    id,
    name: parsed.name,
    rawSourceText,
    sourceMode,
    updatedAt,
  };
}

export function buildSkillSource(name: string, description: string, body: string): string {
  return [
    "---",
    `name: ${yamlValue(name)}`,
    `description: ${yamlValue(description)}`,
    "---",
    body,
  ].join("\n");
}

async function skillRequest(path: string, init: RequestInit, fallback: string): Promise<DenSkill> {
  const { response, payload } = await requestJson(path, init, 20000);
  if (!response.ok) throw getRequestError(payload, response, fallback);
  const item = isRecord(payload) ? parseDenSkill(payload.item) : null;
  if (!item) throw new Error("Den returned an invalid skill response.");
  return item;
}

export async function createSkill(input: { name: string; description: string; body: string }): Promise<DenSkill> {
  return skillRequest("/v1/config-objects", {
    method: "POST",
    body: JSON.stringify({
      type: "skill",
      sourceMode: "cloud",
      input: { rawSourceText: buildSkillSource(input.name, input.description, input.body) },
    }),
  }, "Failed to create the skill.");
}

export async function updateSkill(id: string, input: { name: string; description: string; body: string }): Promise<DenSkill> {
  return skillRequest(`/v1/config-objects/${encodeURIComponent(id)}/versions`, {
    method: "POST",
    body: JSON.stringify({ input: { rawSourceText: buildSkillSource(input.name, input.description, input.body) } }),
  }, "Failed to save the skill.");
}

export async function deleteSkill(id: string): Promise<void> {
  const { response, payload } = await requestJson(
    `/v1/config-objects/${encodeURIComponent(id)}/delete`,
    { method: "POST" },
    20000,
  );
  if (!response.ok) throw getRequestError(payload, response, "Failed to delete the skill safely.");
}

export function useSkills() {
  return useQuery({
    queryKey: skillQueryKeys.list(),
    queryFn: async () => {
      const { response, payload } = await requestJson(
        "/v1/config-objects?type=skill&status=active&limit=100",
        { method: "GET" },
        20000,
      );
      if (!response.ok) throw new Error(getErrorMessage(payload, `Failed to load skills (${response.status}).`));
      const items = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];
      return items.map(parseDenSkill).filter((item): item is DenSkill => item !== null);
    },
  });
}

export function useSkill(id: string) {
  return useQuery({
    queryKey: skillQueryKeys.detail(id),
    queryFn: () => skillRequest(`/v1/config-objects/${encodeURIComponent(id)}`, { method: "GET" }, "Failed to load the skill."),
    enabled: Boolean(id),
  });
}
