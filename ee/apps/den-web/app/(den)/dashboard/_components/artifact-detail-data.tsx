"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  generatedArtifactViewSchema,
  savedScriptDetailSchema,
  type GeneratedArtifactView,
  type SavedScriptDetail,
} from "@openwork/types/dynamic-artifacts";
import { getErrorMessage, requestJson } from "../../_lib/den-flow";

type ArtifactSummary = {
  type: "artifact"; id: string; name: string; description: string | null;
  role: "viewer" | "editor" | "manager"; state: "ready" | "needs_signin" | "needs_admin_setup";
  resultState: "never_run" | "fresh" | "stale" | "needs_attention"; latestSuccessfulAt: string | null;
  viewState: "default" | "custom_active" | "build_failed" | "retired"; activeViewTitle: string | null;
  automationCount: number; source: { kind: "created" | "installed_template" };
};
export type ArtifactDetail = { artifact: ArtifactSummary; script: SavedScriptDetail; views: GeneratedArtifactView[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseArtifactDetail(value: unknown): ArtifactDetail {
  if (!isRecord(value) || !isRecord(value.artifact) || !Array.isArray(value.views)) throw new Error("Artifact response was incomplete.");
  const artifact = value.artifact;
  const role = artifact.role === "viewer" || artifact.role === "editor" || artifact.role === "manager" ? artifact.role : null;
  const state = artifact.state === "ready" || artifact.state === "needs_signin" || artifact.state === "needs_admin_setup" ? artifact.state : null;
  const resultState = artifact.resultState === "never_run" || artifact.resultState === "fresh" || artifact.resultState === "stale" || artifact.resultState === "needs_attention" ? artifact.resultState : null;
  const viewState = artifact.viewState === "default" || artifact.viewState === "custom_active" || artifact.viewState === "build_failed" || artifact.viewState === "retired" ? artifact.viewState : null;
  const sourceKind = isRecord(artifact.source) && (artifact.source.kind === "created" || artifact.source.kind === "installed_template") ? artifact.source.kind : null;
  if (artifact.type !== "artifact" || typeof artifact.id !== "string" || typeof artifact.name !== "string" || !role || !state || !resultState || !viewState || !sourceKind || typeof artifact.automationCount !== "number") {
    throw new Error("Artifact response was incomplete.");
  }
  return {
    artifact: {
      type: "artifact", id: artifact.id, name: artifact.name,
      description: typeof artifact.description === "string" ? artifact.description : null,
      role, state, resultState,
      latestSuccessfulAt: typeof artifact.latestSuccessfulAt === "string" ? artifact.latestSuccessfulAt : null,
      viewState, activeViewTitle: typeof artifact.activeViewTitle === "string" ? artifact.activeViewTitle : null,
      automationCount: artifact.automationCount, source: { kind: sourceKind },
    },
    script: savedScriptDetailSchema.parse(value.script),
    views: value.views.map((view) => generatedArtifactViewSchema.parse(view)),
  };
}

async function mutationJson(path: string, method: "POST" | "PUT") {
  const { response, payload } = await requestJson(path, { method }, 15_000);
  if (!response.ok) throw new Error(getErrorMessage(payload, `Artifact action failed (${response.status}).`));
  return payload;
}

export function useArtifactDetail(artifactId: string) {
  return useQuery({
    queryKey: ["artifact", artifactId],
    queryFn: async () => {
      const { response, payload } = await requestJson(`/v1/artifacts/${encodeURIComponent(artifactId)}`, { method: "GET" }, 15_000);
      if (!response.ok) throw new Error(getErrorMessage(payload, `Failed to load Artifact (${response.status}).`));
      return parseArtifactDetail(payload);
    },
  });
}

export function useActivateArtifactView(artifactId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ viewId, revisionId }: { viewId: string; revisionId: string }) => generatedArtifactViewSchema.parse(await mutationJson(
      `/v1/artifact-views/${encodeURIComponent(viewId)}/revisions/${encodeURIComponent(revisionId)}/activate`,
      "POST",
    )),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["artifact", artifactId] }),
  });
}

export function useRetireArtifactView(artifactId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (viewId: string) => generatedArtifactViewSchema.parse(await mutationJson(
      `/v1/artifact-views/${encodeURIComponent(viewId)}/retire`,
      "POST",
    )),
    onSuccess: async () => client.invalidateQueries({ queryKey: ["artifact", artifactId] }),
  });
}

export function useSelectArtifact() {
  return useMutation({
    mutationFn: async (artifactId: string) => {
      const { response, payload } = await requestJson("/v1/me/artifact-selection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifactId }),
      }, 15_000);
      if (!response.ok) throw new Error(getErrorMessage(payload, `Failed to select Artifact (${response.status}).`));
      return payload;
    },
  });
}
