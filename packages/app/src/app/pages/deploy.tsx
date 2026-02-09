import { Show, createMemo, createSignal } from "solid-js";

import Button from "../components/button";
import type { OpenworkWorkspaceExport, OpenworkServerSettings, OpenworkServerStatus } from "../lib/openwork-server";
import { createOpenworkServerClient, OpenworkServerError } from "../lib/openwork-server";
import type { OpenworkServerInfo } from "../lib/tauri";
import { Download, FileUp, RefreshCcw } from "lucide-solid";

export type DeployViewProps = {
  busy: boolean;
  openworkServerStatus: OpenworkServerStatus;
  openworkServerUrl: string;
  openworkServerSettings: OpenworkServerSettings;
  openworkServerWorkspaceId: string | null;
  openworkServerHostInfo: OpenworkServerInfo | null;
  developerMode: boolean;
};

function formatRequestError(error: unknown): string {
  if (error instanceof OpenworkServerError) {
    return `${error.message} (${error.status})`;
  }
  return error instanceof Error ? error.message : String(error);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function defaultExportFileName(workspaceId: string) {
  const date = new Date().toISOString().slice(0, 10);
  const id = workspaceId.trim() || "workspace";
  return `openwork-bundle-${id}-${date}.json`;
}

export default function DeployView(props: DeployViewProps) {
  const [exportBusy, setExportBusy] = createSignal(false);
  const [exportError, setExportError] = createSignal<string | null>(null);
  const [exportPayload, setExportPayload] = createSignal<OpenworkWorkspaceExport | null>(null);

  const [importText, setImportText] = createSignal("");
  const [importBusy, setImportBusy] = createSignal(false);
  const [importError, setImportError] = createSignal<string | null>(null);
  const [importStatus, setImportStatus] = createSignal<string | null>(null);

  const [modeOpencode, setModeOpencode] = createSignal<"merge" | "replace">("merge");
  const [modeOpenwork, setModeOpenwork] = createSignal<"merge" | "replace">("merge");
  const [modeSkills, setModeSkills] = createSignal<"merge" | "replace">("merge");
  const [modeCommands, setModeCommands] = createSignal<"merge" | "replace">("merge");

  const openworkServerClient = createMemo(() => {
    const baseUrl = props.openworkServerUrl.trim();
    const localBaseUrl = props.openworkServerHostInfo?.baseUrl?.trim() ?? "";
    const hostToken = props.openworkServerHostInfo?.hostToken?.trim() ?? "";
    const clientToken = props.openworkServerHostInfo?.clientToken?.trim() ?? "";
    const settingsToken = props.openworkServerSettings.token?.trim() ?? "";

    const isLocalServer = localBaseUrl && baseUrl === localBaseUrl;
    const token = isLocalServer ? (clientToken || settingsToken) : (settingsToken || clientToken);
    if (!baseUrl || !token) return null;

    return createOpenworkServerClient({
      baseUrl,
      token,
      hostToken: isLocalServer ? hostToken : undefined,
    });
  });

  const serverReady = createMemo(() => props.openworkServerStatus === "connected" && Boolean(openworkServerClient()));
  const workspaceId = createMemo(() => props.openworkServerWorkspaceId?.trim() || "");

  const exportJson = createMemo(() => (exportPayload() ? safeJsonStringify(exportPayload()) : ""));
  const exportSummary = createMemo(() => {
    const payload = exportPayload();
    if (!payload) return null;
    return {
      exportedAt: payload.exportedAt,
      skillCount: payload.skills?.length ?? 0,
      commandCount: payload.commands?.length ?? 0,
    };
  });

  const parsedImport = createMemo(() => {
    const raw = importText().trim();
    if (!raw) return { ok: false as const, error: null as string | null, payload: null as any };
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      return { ok: true as const, error: null as string | null, payload };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Invalid JSON", payload: null as any };
    }
  });

  const fetchExport = async () => {
    if (exportBusy()) return;
    if (!serverReady()) return;
    if (!workspaceId()) return;
    const client = openworkServerClient();
    if (!client) return;

    setExportBusy(true);
    setExportError(null);
    try {
      const payload = await client.exportWorkspace(workspaceId());
      setExportPayload(payload);
    } catch (error) {
      setExportError(formatRequestError(error));
    } finally {
      setExportBusy(false);
    }
  };

  const downloadExport = () => {
    const json = exportJson();
    const id = workspaceId();
    if (!json || !id) return;

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultExportFileName(id);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setImportText(text);
      setImportError(null);
      setImportStatus(null);
    } catch (error) {
      setImportError(formatRequestError(error));
    }
  };

  const importBundle = async (options?: { reload?: boolean }) => {
    if (importBusy()) return;
    if (!serverReady()) return;
    if (!workspaceId()) return;
    const client = openworkServerClient();
    if (!client) return;

    setImportBusy(true);
    setImportError(null);
    setImportStatus(null);

    try {
      const parsed = parsedImport();
      if (!parsed.ok) {
        setImportError(parsed.error || "Invalid JSON");
        return;
      }

      const mode = {
        opencode: modeOpencode(),
        openwork: modeOpenwork(),
        skills: modeSkills(),
        commands: modeCommands(),
      };

      const payload = {
        ...parsed.payload,
        mode,
      };

      await client.importWorkspace(workspaceId(), payload);
      setImportStatus(options?.reload ? "Imported. Reloading engine..." : "Imported. Reload required.");

      if (options?.reload) {
        await client.reloadEngine(workspaceId());
        setImportStatus("Imported and reloaded.");
      }
    } catch (error) {
      setImportError(formatRequestError(error));
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div class="space-y-6">
      <div>
        <div class="text-sm font-semibold text-gray-12">Deploy (stateless bundle)</div>
        <div class="mt-1 text-xs text-gray-9">
          Deploy is export/import/reload. Bundles include skills/commands/config; they do not include owpenbot credentials.
        </div>
      </div>

      <Show when={!serverReady()}>
        <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm">
          <div class="text-sm font-semibold text-gray-12">Connect to an OpenWork server</div>
          <div class="mt-1 text-xs text-gray-10">
            Deploy requires a connected OpenWork host (`openwrk`) so it can call export/import endpoints.
          </div>
        </div>
      </Show>

      <Show when={serverReady()}>
        <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm space-y-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-gray-12">Export</div>
              <div class="text-xs text-gray-9">Fetch a JSON bundle you can import into another worker.</div>
            </div>
            <div class="flex items-center gap-2">
              <Button
                variant="secondary"
                class="h-8 px-3 text-xs"
                onClick={fetchExport}
                disabled={exportBusy() || !workspaceId()}
              >
                <RefreshCcw size={14} class={exportBusy() ? "animate-spin" : ""} />
                <span class="ml-2">Fetch bundle</span>
              </Button>
              <Button
                variant="outline"
                class="h-8 px-3 text-xs"
                onClick={downloadExport}
                disabled={!exportPayload()}
              >
                <Download size={14} />
                <span class="ml-2">Download</span>
              </Button>
            </div>
          </div>

          <Show when={exportError()}>
            {(value) => (
              <div class="rounded-xl border border-red-7/20 bg-red-1/30 px-4 py-3 text-xs text-red-12">
                {value()}
              </div>
            )}
          </Show>

          <Show when={exportSummary()}>
            {(summary) => (
              <div class="text-xs text-gray-10">
                Exported {new Date(summary().exportedAt).toLocaleString()} • {summary().skillCount} skills • {summary().commandCount} commands
              </div>
            )}
          </Show>

          <Show when={exportPayload()}>
            <textarea
              value={exportJson()}
              readOnly
              class="w-full min-h-[160px] rounded-xl border border-gray-5 bg-gray-1 px-3 py-2 text-xs font-mono text-gray-12 focus:outline-none"
            />
          </Show>
        </div>

        <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm space-y-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-gray-12">Import</div>
              <div class="text-xs text-gray-9">Paste or upload a bundle JSON, then import (and optionally reload).</div>
            </div>
            <label class="inline-flex items-center gap-2 text-xs text-gray-10 cursor-pointer">
              <input
                type="file"
                accept="application/json,.json"
                class="hidden"
                onChange={(event) => void handleImportFile(event.currentTarget.files?.[0] ?? null)}
              />
              <span class="inline-flex items-center rounded-xl border border-gray-5 bg-gray-1 px-3 py-2">
                <FileUp size={14} />
                <span class="ml-2">Upload JSON</span>
              </span>
            </label>
          </div>

          <textarea
            value={importText()}
            onInput={(e) => setImportText(e.currentTarget.value)}
            placeholder="Paste bundle JSON here"
            class="w-full min-h-[160px] rounded-xl border border-gray-5 bg-gray-1 px-3 py-2 text-xs font-mono text-gray-12 placeholder:text-gray-8 focus:outline-none"
          />

          <Show when={!parsedImport().ok && parsedImport().error}>
            <div class="text-xs text-amber-11">Invalid JSON: {parsedImport().error}</div>
          </Show>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="rounded-xl border border-gray-5 bg-gray-1 p-3">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-9">Import mode</div>
              <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
                <ModeToggle label="opencode" value={modeOpencode()} setValue={setModeOpencode} />
                <ModeToggle label="openwork" value={modeOpenwork()} setValue={setModeOpenwork} />
                <ModeToggle label="skills" value={modeSkills()} setValue={setModeSkills} />
                <ModeToggle label="commands" value={modeCommands()} setValue={setModeCommands} />
              </div>
              <div class="mt-2 text-[11px] text-gray-9">
                Merge is safer; replace wipes the target category before importing.
              </div>
            </div>

            <div class="rounded-xl border border-gray-5 bg-gray-1 p-3">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-9">Apply recipe</div>
              <div class="mt-2 text-[11px] text-gray-10">
                After import, reload the engine to pick up skills/commands/config.
              </div>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              class="h-9 px-4 text-xs"
              onClick={() => void importBundle({ reload: false })}
              disabled={importBusy() || !parsedImport().ok || !workspaceId()}
            >
              {importBusy() ? "Importing..." : "Import"}
            </Button>
            <Button
              variant="primary"
              class="h-9 px-4 text-xs"
              onClick={() => void importBundle({ reload: true })}
              disabled={importBusy() || !parsedImport().ok || !workspaceId()}
            >
              {importBusy() ? "Importing..." : "Import + Reload"}
            </Button>
          </div>

          <Show when={importStatus()}>
            {(value) => (
              <div class="rounded-xl border border-emerald-7/20 bg-emerald-1/20 px-4 py-3 text-xs text-emerald-11">
                {value()}
              </div>
            )}
          </Show>

          <Show when={importError()}>
            {(value) => (
              <div class="rounded-xl border border-red-7/20 bg-red-1/30 px-4 py-3 text-xs text-red-12">
                {value()}
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

function ModeToggle(props: {
  label: string;
  value: "merge" | "replace";
  setValue: (next: "merge" | "replace") => void;
}) {
  return (
    <button
      type="button"
      class={`rounded-lg border px-2 py-1 text-left ${
        props.value === "merge" ? "border-gray-6 bg-gray-2/50 text-gray-12" : "border-gray-5 bg-gray-1 text-gray-11"
      }`}
      onClick={() => props.setValue(props.value === "merge" ? "replace" : "merge")}
      title="Click to toggle"
    >
      <span class="font-semibold">{props.label}</span>
      <span class="ml-2 text-[11px] text-gray-9">{props.value}</span>
    </button>
  );
}
