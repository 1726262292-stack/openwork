/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { Bot, FolderLock, Image, Loader2, Settings2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextInput } from "../../../design-system/text-input";
import type { OpenworkServerCapabilities, OpenworkServerClient, OpenworkServerStatus } from "../../../../app/lib/openwork-server";
import type { ModelRef, ProviderListItem } from "../../../../app/types";
import { cn } from "@/lib/utils";
import { AuthorizedFoldersPanel } from "../../settings/panels/authorized-folders-panel";
import { OpenAiImageExtensionCard } from "../../settings/openai-image-extension-card";

export type SessionSettingsSection = "local-models" | "authorized-folders" | "image-generation";

export type LocalProviderInstallInput = {
  providerId: string;
  name: string;
  baseURL: string;
  modelId: string;
  modelName: string;
  setDefault: boolean;
};

export type SessionSettingsPanelProps = {
  activeSection: SessionSettingsSection;
  onSectionChange: (section: SessionSettingsSection) => void;
  onClose: () => void;
  providers: ProviderListItem[];
  providerConnectedIds: string[];
  selectedModel: ModelRef | null;
  localProviderBusy: boolean;
  localProviderStatus: string | null;
  localProviderError: string | null;
  onInstallLocalProvider: (input: LocalProviderInstallInput) => Promise<void> | void;
  openworkServerClient: OpenworkServerClient | null;
  openworkServerStatus: OpenworkServerStatus;
  openworkServerCapabilities: OpenworkServerCapabilities | null;
  runtimeWorkspaceId: string | null;
  selectedWorkspaceRoot: string;
  activeWorkspaceType: "local" | "remote";
  onAuthorizedFoldersUpdated: () => void;
  imageExtensionInstalled: boolean;
  imageExtensionBusy: boolean;
  imageExtensionStatus: string | null;
  imageExtensionError: string | null;
  imageGenerationBusy: boolean;
  imageGenerationStatus: string | null;
  imageGenerationError: string | null;
  onInstallImageExtension: (apiKey: string) => Promise<void> | void;
  onGenerateTestImage: (input: { apiKey: string; prompt: string }) => Promise<void> | void;
  onOpenFullSettings: (path: string) => void;
};

const LOCAL_PROVIDER_PRESETS = [
  {
    id: "ollama",
    label: "Ollama",
    name: "Ollama (local)",
    baseURL: "http://localhost:11434/v1",
    defaultModelId: "qwen2.5-coder:7b",
    pullCommand: "ollama pull qwen2.5-coder:7b",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    name: "LM Studio (local)",
    baseURL: "http://127.0.0.1:1234/v1",
    defaultModelId: "google/gemma-3n-e4b",
    pullCommand: "Start the LM Studio local server and load a model.",
  },
  {
    id: "llama.cpp",
    label: "llama.cpp",
    name: "llama-server (local)",
    baseURL: "http://127.0.0.1:8080/v1",
    defaultModelId: "qwen3-coder:a3b",
    pullCommand: "Start llama-server on port 8080 with your model.",
  },
] as const;

function sectionLabel(section: SessionSettingsSection) {
  if (section === "authorized-folders") return "Authorized folders";
  if (section === "image-generation") return "Image generation";
  return "Local models";
}

function SectionButton(props: {
  section: SessionSettingsSection;
  active: boolean;
  icon: typeof Bot;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
        props.active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      onClick={props.onClick}
    >
      <Icon size={15} />
      <span>{sectionLabel(props.section)}</span>
    </button>
  );
}

export function SessionSettingsPanel(props: SessionSettingsPanelProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<(typeof LOCAL_PROVIDER_PRESETS)[number]["id"]>("ollama");
  const selectedPreset = LOCAL_PROVIDER_PRESETS.find((preset) => preset.id === selectedPresetId) ?? LOCAL_PROVIDER_PRESETS[0];
  const [modelIdByPreset, setModelIdByPreset] = useState<Record<string, string>>(() =>
    Object.fromEntries(LOCAL_PROVIDER_PRESETS.map((preset) => [preset.id, preset.defaultModelId])),
  );
  const [setDefault, setSetDefault] = useState(true);
  const modelId = modelIdByPreset[selectedPreset.id] ?? selectedPreset.defaultModelId;

  const connectedLocalProviders = useMemo(() => {
    const localIds = new Set<string>(LOCAL_PROVIDER_PRESETS.map((preset) => preset.id));
    const connected = new Set(props.providerConnectedIds);
    return props.providers.filter((provider) => localIds.has(provider.id) || connected.has(provider.id));
  }, [props.providerConnectedIds, props.providers]);

  const installLocalProvider = () => {
    const trimmedModelId = modelId.trim();
    if (!trimmedModelId) return;
    void props.onInstallLocalProvider({
      providerId: selectedPreset.id,
      name: selectedPreset.name,
      baseURL: selectedPreset.baseURL,
      modelId: trimmedModelId,
      modelName: trimmedModelId,
      setDefault,
    });
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Settings2 size={16} className="text-muted-foreground" />
          <div className="truncate text-sm font-semibold">Settings</div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={props.onClose} aria-label="Close settings pane">
          <X size={16} />
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(0,1fr)]">
        <nav className="border-r border-border p-2">
          <div className="space-y-1">
            <SectionButton
              section="local-models"
              active={props.activeSection === "local-models"}
              icon={Bot}
              onClick={() => props.onSectionChange("local-models")}
            />
            <SectionButton
              section="authorized-folders"
              active={props.activeSection === "authorized-folders"}
              icon={FolderLock}
              onClick={() => props.onSectionChange("authorized-folders")}
            />
            <SectionButton
              section="image-generation"
              active={props.activeSection === "image-generation"}
              icon={Image}
              onClick={() => props.onSectionChange("image-generation")}
            />
          </div>
        </nav>

        <div className="min-h-0 overflow-y-auto p-4">
          {props.activeSection === "local-models" ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Add a local model</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Configure an OpenAI-compatible local provider and set it as the default model for this workspace.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {LOCAL_PROVIDER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn(
                      "rounded-2xl border px-3 py-3 text-left transition-colors",
                      selectedPreset.id === preset.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted",
                    )}
                    onClick={() => setSelectedPresetId(preset.id)}
                  >
                    <div className="text-sm font-medium">{preset.label}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{preset.baseURL}</div>
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <div className="text-xs font-medium text-muted-foreground">Before adding</div>
                <code className="mt-2 block rounded-xl bg-background px-3 py-2 text-xs text-foreground">
                  {selectedPreset.pullCommand}
                </code>
              </div>

              <TextInput
                label="Model ID"
                value={modelId}
                onChange={(event) => setModelIdByPreset((current) => ({ ...current, [selectedPreset.id]: event.currentTarget.value }))}
                placeholder={selectedPreset.defaultModelId}
              />

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={setDefault}
                  onChange={(event) => setSetDefault(event.currentTarget.checked)}
                />
                Set this model as default after adding it
              </label>

              <div className="flex flex-wrap gap-2">
                <Button onClick={installLocalProvider} disabled={props.localProviderBusy || !modelId.trim()}>
                  {props.localProviderBusy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                  Add {selectedPreset.label}
                </Button>
                <Button variant="outline" onClick={() => props.onOpenFullSettings("/settings/ai")}>Open full providers</Button>
              </div>

              {props.localProviderStatus ? (
                <div className="rounded-xl border border-green-6 bg-green-2 px-3 py-2 text-sm text-green-11">
                  {props.localProviderStatus}
                </div>
              ) : null}
              {props.localProviderError ? (
                <div className="rounded-xl border border-red-6 bg-red-2 px-3 py-2 text-sm text-red-11">
                  {props.localProviderError}
                </div>
              ) : null}

              <div className="space-y-2">
                <h3 className="text-sm font-medium">Configured providers</h3>
                {connectedLocalProviders.length > 0 ? (
                  <div className="space-y-2">
                    {connectedLocalProviders.map((provider) => (
                      <div key={provider.id} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
                        <div>
                          <div className="font-medium">{provider.name || provider.id}</div>
                          <div className="font-mono text-xs text-muted-foreground">{provider.id}</div>
                        </div>
                        {props.selectedModel?.providerID === provider.id ? (
                          <span className="rounded-full bg-green-3 px-2 py-1 text-xs text-green-11">Default</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No local model provider is configured yet.</p>
                )}
              </div>
            </div>
          ) : null}

          {props.activeSection === "authorized-folders" ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Authorize folder access</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Add folders that OpenWork and OpenCode can read or write from this workspace.
                </p>
              </div>
              <AuthorizedFoldersPanel
                openworkServerClient={props.openworkServerClient}
                openworkServerStatus={props.openworkServerStatus}
                openworkServerCapabilities={props.openworkServerCapabilities}
                runtimeWorkspaceId={props.runtimeWorkspaceId}
                selectedWorkspaceRoot={props.selectedWorkspaceRoot}
                activeWorkspaceType={props.activeWorkspaceType}
                onConfigUpdated={props.onAuthorizedFoldersUpdated}
              />
            </div>
          ) : null}

          {props.activeSection === "image-generation" ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Image generation extension</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Install the OpenWork extension backed by an OpenCode plugin and OpenWork environment variable.
                </p>
              </div>
              <OpenAiImageExtensionCard
                installed={props.imageExtensionInstalled}
                installBusy={props.imageExtensionBusy}
                installStatus={props.imageExtensionStatus}
                installError={props.imageExtensionError}
                generationBusy={props.imageGenerationBusy}
                generationStatus={props.imageGenerationStatus}
                generationError={props.imageGenerationError}
                onInstall={props.onInstallImageExtension}
                onGenerateTestImage={props.onGenerateTestImage}
                onOpenPlugins={() => props.onOpenFullSettings("/settings/extensions/plugins")}
                showOpenPlugins
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
