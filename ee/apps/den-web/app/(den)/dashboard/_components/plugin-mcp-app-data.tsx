"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRequestError, requestJson } from "../../_lib/den-flow";
import { pluginQueryKeys } from "./plugin-data";

export type PluginMcpAppDocumentMetadata = {
  name: string;
  version: string;
  description?: string;
  launchTool?: { title?: string; description?: string };
};

export type PluginMcpAppRevision = {
  id: string;
  active: boolean;
  createdAt: string;
  createdByOrgMembershipId: string | null;
  metadata: PluginMcpAppDocumentMetadata;
  source: { url: string; resolvedUrl: string; fetchedAt: string; contentType: string | null };
  resource: {
    byteSize: number;
    digest: string;
    csp: { connectDomains: string[]; resourceDomains: string[]; frameDomains: string[]; baseUriDomains: string[] };
  };
  diagnostics: string[];
  resourceUri: string;
};

export type PluginMcpApp = {
  id: string;
  pluginId: string;
  status: "active" | "retired";
  sourceUrl: string;
  resolvedSourceUrl: string;
  activeVersionId: string | null;
  activeRevision: PluginMcpAppRevision | null;
  latestRevision: PluginMcpAppRevision | null;
  revisions: PluginMcpAppRevision[];
  role: "viewer" | "editor" | "manager";
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
};

export type PluginMcpAppPreview = {
  metadata: PluginMcpAppDocumentMetadata;
  sourceUrl: string;
  resolvedSourceUrl: string;
  resource: PluginMcpAppRevision["resource"];
  diagnostics: string[];
};

export const pluginMcpAppQueryKeys = {
  detail: (appId: string) => ["plugin-mcp-apps", appId] as const,
};

function itemFromPayload(payload: unknown): PluginMcpApp {
  if (!payload || typeof payload !== "object" || !("item" in payload)) {
    throw new Error("MCP App response was incomplete.");
  }
  return (payload as { item: PluginMcpApp }).item;
}

async function appRequest(path: string, init?: RequestInit) {
  const { response, payload } = await requestJson(path, init, 30000);
  if (!response.ok) throw getRequestError(payload, response, `MCP App request failed (${response.status}).`);
  return itemFromPayload(payload);
}

export function usePreviewPluginMcpApp() {
  return useMutation({
    mutationFn: async (sourceUrl: string): Promise<PluginMcpAppPreview> => {
      const { response, payload } = await requestJson("/v1/remote-mcp-apps/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrl }),
      }, 30000);
      if (!response.ok) throw getRequestError(payload, response, `App preview failed (${response.status}).`);
      return (payload as { preview: PluginMcpAppPreview }).preview;
    },
  });
}

export function useInstallPluginMcpApp(pluginId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { sourceUrl: string }) => appRequest("/v1/remote-mcp-apps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, pluginId, activate: true }),
    }),
    onSuccess: async (app) => {
      queryClient.setQueryData(pluginMcpAppQueryKeys.detail(app.id), app);
      await queryClient.invalidateQueries({ queryKey: pluginQueryKeys.detail(pluginId) });
    },
  });
}

export function usePluginMcpApp(appId: string) {
  return useQuery({
    queryKey: pluginMcpAppQueryKeys.detail(appId),
    queryFn: () => appRequest(`/v1/remote-mcp-apps/${encodeURIComponent(appId)}`),
  });
}

function useAppMutation(
  appId: string,
  pluginId: string | null,
  request: (input: unknown) => Promise<PluginMcpApp>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async (app) => {
      queryClient.setQueryData(pluginMcpAppQueryKeys.detail(appId), app);
      if (pluginId) await queryClient.invalidateQueries({ queryKey: pluginQueryKeys.detail(pluginId) });
    },
  });
}

export function useRefreshPluginMcpApp(appId: string, pluginId: string | null) {
  return useAppMutation(appId, pluginId, (input) => {
    const body = input as { sourceUrl?: string };
    return appRequest(`/v1/remote-mcp-apps/${encodeURIComponent(appId)}/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  });
}

export function useActivatePluginMcpApp(appId: string, pluginId: string | null) {
  return useAppMutation(appId, pluginId, (input) => appRequest(`/v1/remote-mcp-apps/${encodeURIComponent(appId)}/activate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export function usePluginMcpAppLifecycle(appId: string, pluginId: string | null) {
  return useAppMutation(appId, pluginId, (input) => appRequest(`/v1/remote-mcp-apps/${encodeURIComponent(appId)}/lifecycle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function downloadPluginMcpAppRevision(appId: string, versionId: string, fileName: string) {
  const { response, payload, text } = await requestJson(
    `/v1/remote-mcp-apps/${encodeURIComponent(appId)}/revisions/${encodeURIComponent(versionId)}/download`,
    {},
    30000,
  );
  if (!response.ok) {
    throw getRequestError(payload, response, `App download failed (${response.status}).`);
  }
  const objectUrl = URL.createObjectURL(new Blob([text], {
    type: response.headers.get("content-type") ?? "text/html;charset=utf-8",
  }));
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
