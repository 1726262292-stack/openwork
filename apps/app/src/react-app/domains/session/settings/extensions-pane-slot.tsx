/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ExtensionCard } from "../../../design-system/extension-card";
import { ExtensionDetailModal } from "../../../design-system/extension-detail-modal";
import { MCP_QUICK_CONNECT, getMcpServerName, type McpDirectoryInfo } from "../../../../app/constants";
import { isOpenWorkExtensionEnabled, OPENWORK_EXTENSION_STATE_CHANGED, setOpenWorkExtensionEnabled } from "../../settings/extension-state";
import { getExtensionConfigSlot, type ExtensionConfigContext } from "../../settings/extension-registry";
import {
  IMAGE_GENERATION_EXTENSION_CONFIG_PATH,
  IMAGE_GENERATION_PLUGIN_CONTENT,
  IMAGE_GENERATION_PLUGIN_PATH,
  OPENAI_IMAGE_MODEL,
  OLLAMA_PROVIDER_CONFIG,
  openAiImageResponseToArrayBuffer,
  slugifyImageArtifactName,
  type LocalProviderInstallInput,
} from "../../settings/openai-image-extension";
import { desktopFetch } from "../../../../app/lib/desktop";
import type { OpenworkServerClient } from "../../../../app/lib/openwork-server";
import type { ProviderListItem } from "../../../../app/types";

// Side-effect: register extension configs
import "../../settings/openai-image-gen-config";
import "../../settings/ollama-config";
import "../../settings/browser-extension-config";

export type ExtensionsPaneSlotProps = {
  openworkClient: OpenworkServerClient | null;
  workspaceClient: OpenworkServerClient | null;
  workspaceId: string | null;
  providers: ProviderListItem[];
  providerConnectedIds: string[];
  onReloadRequired: (reason: string, trigger: { type: string; name: string; action: string }) => void;
  onRefreshProviders: () => Promise<void> | void;
  onSetDefaultModel?: (providerId: string, modelId: string) => void;
};

export function ExtensionsPaneSlot(props: ExtensionsPaneSlotProps) {
  const [detailEntry, setDetailEntry] = useState<McpDirectoryInfo | null>(null);
  const [imageInstalled, setImageInstalled] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [lpBusy, setLpBusy] = useState(false);
  const [lpStatus, setLpStatus] = useState<string | null>(null);
  const [lpError, setLpError] = useState<string | null>(null);
  const [, setExtensionStateVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setExtensionStateVersion((value) => value + 1);
    window.addEventListener(OPENWORK_EXTENSION_STATE_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(OPENWORK_EXTENSION_STATE_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    const client = props.workspaceClient;
    const wid = props.workspaceId?.trim();
    if (!client || !wid) { setImageInstalled(false); return; }
    let cancelled = false;
    void client.listPlugins(wid, { includeGlobal: false })
      .then((r) => { if (!cancelled) setImageInstalled(r.items.some((i) => i.spec.includes("openwork-image-generation") || i.path?.includes("openwork-image-generation") === true)); })
      .catch(() => { if (!cancelled) setImageInstalled(false); });
    return () => { cancelled = true; };
  }, [props.workspaceClient, props.workspaceId]);

  const installImage = useCallback(async (apiKey: string) => {
    const client = props.workspaceClient;
    const wid = props.workspaceId?.trim();
    if (!client || !wid || !apiKey.trim()) { setImageError("API key and workspace required."); return; }
    setImageBusy(true); setImageStatus(null); setImageError(null);
    try {
      const enc = new TextEncoder();
      await client.writeWorkspaceBinaryFile(wid, { path: IMAGE_GENERATION_PLUGIN_PATH, data: enc.encode(IMAGE_GENERATION_PLUGIN_CONTENT).buffer, force: true });
      await client.writeWorkspaceBinaryFile(wid, { path: IMAGE_GENERATION_EXTENSION_CONFIG_PATH, data: enc.encode(JSON.stringify({ id: "openai-image-generation", name: "OpenAI Image Generation", type: "openwork-extension", model: OPENAI_IMAGE_MODEL, apiKey: apiKey.trim(), env: ["OPENAI_API_KEY"] }, null, 2)).buffer, force: true });
      await client.writeWorkspaceBinaryFile(wid, { path: ".opencode/package.json", data: enc.encode(JSON.stringify({ dependencies: { "@opencode-ai/plugin": "1.14.38" } }, null, 2)).buffer, force: true });
      if (props.openworkClient) await props.openworkClient.upsertUserEnv([{ key: "OPENAI_API_KEY", value: apiKey.trim() }]);
      props.onReloadRequired("plugins", { type: "plugin", name: "openwork-image-generation", action: "added" });
      setImageInstalled(true);
      setImageStatus("Installed.");
    } catch (e) { setImageError(e instanceof Error ? e.message : String(e)); } finally { setImageBusy(false); }
  }, [props]);

  const testGen = useCallback(async (input: { apiKey: string; prompt: string }) => {
    const client = props.workspaceClient;
    const wid = props.workspaceId?.trim();
    if (!client || !wid || !input.apiKey.trim() || !input.prompt.trim()) { setGenError("Required fields missing."); return; }
    setGenBusy(true); setGenStatus(null); setGenError(null);
    try {
      const res = await desktopFetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt: input.prompt }) });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error?.message || "Image generation failed.");
      const data = await openAiImageResponseToArrayBuffer(payload);
      const fn = `${slugifyImageArtifactName(input.prompt)}.png`;
      await client.writeWorkspaceBinaryFile(wid, { path: `artifacts/${fn}`, data, force: true });
      setGenStatus(`Generated artifacts/${fn}.`);
    } catch (e) { setGenError(e instanceof Error ? e.message : String(e)); } finally { setGenBusy(false); }
  }, [props]);

  const installLocal = useCallback(async (input: LocalProviderInstallInput) => {
    const client = props.workspaceClient;
    const wid = props.workspaceId?.trim();
    if (!client || !wid || !input.modelId.trim()) { setLpError("Workspace and model required."); return; }
    setLpBusy(true); setLpStatus(null); setLpError(null);
    try {
      await client.patchConfig(wid, { opencode: { provider: { [input.providerId]: { npm: "@ai-sdk/openai-compatible", name: input.name, options: { baseURL: input.baseURL }, models: { [input.modelId]: { name: input.modelName || input.modelId } } } } } });
      if (input.setDefault) props.onSetDefaultModel?.(input.providerId, input.modelId);
      props.onReloadRequired("config", { type: "config", name: "opencode.json", action: "updated" });
      try { await client.reloadEngine(wid); } catch {}
      await props.onRefreshProviders();
      setLpStatus(`Added ${input.name} with ${input.modelId}.`);
    } catch (e) { setLpError(e instanceof Error ? e.message : String(e)); } finally { setLpBusy(false); }
  }, [props]);

  const configCtx: ExtensionConfigContext = {
    imageExtension: {
      busy: imageBusy || genBusy,
      status: imageStatus ?? genStatus,
      error: imageError ?? genError,
      envKeyDetected: props.providers.some((p) => p.id === "openai" && p.source === "env") || props.providerConnectedIds.includes("openai"),
      onInstall: installImage,
      onTestGenerate: testGen,
    },
    localProvider: { busy: lpBusy, status: lpStatus, error: lpError, onInstall: installLocal },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3">
        {MCP_QUICK_CONNECT.map((entry) => {
          const id = entry.serverName ?? getMcpServerName(entry);
          const connected = entry.kind === "extension"
            ? (entry.defaultEnabled ? isOpenWorkExtensionEnabled(entry) : id === "openai-image-gen" ? imageInstalled : props.providerConnectedIds.includes(id))
            : false;
          return (
            <ExtensionCard
              key={id}
              name={entry.name}
              description={entry.description}
              iconSlug={entry.iconSlug}
              iconSrc={entry.iconSrc}
              kind={entry.kind ?? "mcp"}
              connected={connected}
              actionLabel={connected ? "Configure" : entry.defaultEnabled ? "Enable in composer" : "Tap to connect"}
              onClick={() => setDetailEntry(entry)}
            />
          );
        })}
      </div>
      {detailEntry ? (() => {
        const slot = getExtensionConfigSlot(detailEntry, configCtx);
        const id = detailEntry.serverName ?? getMcpServerName(detailEntry);
        const connected = detailEntry.kind === "extension"
          ? (detailEntry.defaultEnabled ? isOpenWorkExtensionEnabled(detailEntry) : id === "openai-image-gen" ? imageInstalled : props.providerConnectedIds.includes(id))
          : false;
        return (
          <ExtensionDetailModal
            open
            onClose={() => setDetailEntry(null)}
            name={detailEntry.name}
            description={detailEntry.description}
            iconSlug={detailEntry.iconSlug}
            iconSrc={detailEntry.iconSrc}
            kind={detailEntry.kind ?? "mcp"}
            connected={connected}
            url={typeof detailEntry.url === "string" ? detailEntry.url : undefined}
            oauth={detailEntry.oauth}
            configSlot={slot}
            onConnect={detailEntry.defaultEnabled ? () => {
              setOpenWorkExtensionEnabled(detailEntry, true);
              setDetailEntry(null);
            } : slot ? undefined : () => setDetailEntry(null)}
            onUninstall={detailEntry.defaultEnabled && connected ? () => {
              setOpenWorkExtensionEnabled(detailEntry, false);
            } : undefined}
          />
        );
      })() : null}
    </div>
  );
}
