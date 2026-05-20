/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import { Bot, CheckCircle2, Download, Loader2, RefreshCw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextInput } from "../../design-system/text-input";
import { surfaceCardClass } from "../workspace/modal-styles";
import { OLLAMA_PROVIDER_CONFIG } from "./openai-image-extension";
import { registerExtensionConfig } from "./extension-registry";

registerExtensionConfig("ollama", (ctx) => (
  <OllamaConfig
    busy={ctx.localProvider.busy}
    status={ctx.localProvider.status}
    error={ctx.localProvider.error}
    onInstall={ctx.localProvider.onInstall}
  />
));

type OllamaModel = { name: string; size: number; modified_at: string };

type OllamaStatus = "checking" | "running" | "unreachable";

async function checkOllama(): Promise<{ status: OllamaStatus; models: OllamaModel[] }> {
  try {
    const response = await fetch(`${OLLAMA_PROVIDER_CONFIG.baseURL.replace("/v1", "")}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { status: "unreachable", models: [] };
    const data = await response.json();
    return { status: "running", models: Array.isArray(data?.models) ? data.models : [] };
  } catch {
    return { status: "unreachable", models: [] };
  }
}

async function pullOllamaModel(
  modelName: string,
  onProgress: (status: string) => void,
): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_PROVIDER_CONFIG.baseURL.replace("/v1", "")}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.status) {
            const pct = parsed.completed && parsed.total
              ? ` (${Math.round((parsed.completed / parsed.total) * 100)}%)`
              : "";
            onProgress(`${parsed.status}${pct}`);
          }
          if (parsed.error) {
            onProgress(`Error: ${parsed.error}`);
            return false;
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
    return true;
  } catch (error) {
    onProgress(`Pull failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export type OllamaConfigProps = {
  busy: boolean;
  status: string | null;
  error: string | null;
  onInstall: (input: {
    providerId: string;
    name: string;
    baseURL: string;
    modelId: string;
    modelName: string;
    setDefault: boolean;
  }) => void | Promise<void>;
};

export function OllamaConfig(props: OllamaConfigProps) {
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("checking");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [customModel, setCustomModel] = useState(OLLAMA_PROVIDER_CONFIG.defaultModelId);
  const [useCustom, setUseCustom] = useState(false);
  const [setDefault, setSetDefault] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<string | null>(null);

  const activeModelId = useCustom ? customModel.trim() : selectedModel;

  const refresh = useCallback(async () => {
    setOllamaStatus("checking");
    const result = await checkOllama();
    setOllamaStatus(result.status);
    setModels(result.models);
    if (result.models.length > 0 && !selectedModel) {
      setSelectedModel(result.models[0].name);
    }
  }, [selectedModel]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePull = async () => {
    const model = customModel.trim();
    if (!model) return;
    setPulling(true);
    setPullProgress("Starting pull...");
    const ok = await pullOllamaModel(model, setPullProgress);
    setPulling(false);
    if (ok) {
      setPullProgress(`Pulled ${model} successfully.`);
      await refresh();
      setSelectedModel(model);
      setUseCustom(false);
    }
  };

  const handleInstall = () => {
    if (!activeModelId) return;
    void props.onInstall({
      providerId: OLLAMA_PROVIDER_CONFIG.providerId,
      name: OLLAMA_PROVIDER_CONFIG.name,
      baseURL: OLLAMA_PROVIDER_CONFIG.baseURL,
      modelId: activeModelId,
      modelName: activeModelId,
      setDefault,
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes > 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${bytes} B`;
  };

  return (
    <div className="space-y-4">
      <div className={`${surfaceCardClass} space-y-4 p-4`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">
          Configuration
        </div>

        {/* Connection status */}
        <div className="flex items-center justify-between rounded-xl border border-dls-border bg-dls-hover px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            {ollamaStatus === "checking" ? (
              <Loader2 size={14} className="animate-spin text-dls-secondary" />
            ) : ollamaStatus === "running" ? (
              <CheckCircle2 size={14} className="text-green-11" />
            ) : (
              <XCircle size={14} className="text-red-11" />
            )}
            <span className="text-dls-text">
              {ollamaStatus === "checking"
                ? "Checking Ollama..."
                : ollamaStatus === "running"
                  ? `Ollama running (${models.length} model${models.length === 1 ? "" : "s"})`
                  : "Ollama not reachable"}
            </span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} disabled={ollamaStatus === "checking"}>
            <RefreshCw size={14} className={ollamaStatus === "checking" ? "animate-spin" : ""} />
          </Button>
        </div>

        {ollamaStatus === "unreachable" ? (
          <div className="rounded-xl border border-amber-6 bg-amber-2 px-3 py-2 text-xs text-amber-11">
            <div className="font-medium">Install Ollama first</div>
            <div className="mt-1">
              Visit{" "}
              <a
                href="https://ollama.com/download"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                ollama.com/download
              </a>{" "}
              to install, then start it and come back here.
            </div>
          </div>
        ) : null}

        {/* Model selection */}
        {ollamaStatus === "running" && models.length > 0 && !useCustom ? (
          <div className="space-y-2">
            <div className="text-xs font-medium text-dls-text">Available models</div>
            <div className="grid gap-1.5">
              {models.map((model) => (
                <button
                  key={model.name}
                  type="button"
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    selectedModel === model.name
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-dls-border bg-dls-surface hover:bg-dls-hover"
                  }`}
                  onClick={() => setSelectedModel(model.name)}
                >
                  <span className="font-mono font-medium">{model.name}</span>
                  <span className="text-muted-foreground">{formatSize(model.size)}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setUseCustom(true)}
            >
              Pull a different model...
            </button>
          </div>
        ) : null}

        {/* Custom model / pull */}
        {(useCustom || (ollamaStatus === "running" && models.length === 0)) ? (
          <div className="space-y-3">
            <TextInput
              label="Model to pull"
              value={customModel}
              onChange={(event) => setCustomModel(event.currentTarget.value)}
              placeholder={OLLAMA_PROVIDER_CONFIG.defaultModelId}
              hint="Enter a model name from ollama.com/library"
            />
            <Button
              variant="outline"
              onClick={() => void handlePull()}
              disabled={pulling || !customModel.trim()}
            >
              {pulling ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {pulling ? "Pulling..." : `Pull ${customModel.trim() || "model"}`}
            </Button>
            {pullProgress ? (
              <div className="rounded-xl border border-dls-border bg-dls-hover px-3 py-2 font-mono text-xs text-dls-text">
                {pullProgress}
              </div>
            ) : null}
            {models.length > 0 ? (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setUseCustom(false)}
              >
                Back to loaded models
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Set as default */}
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={setDefault}
            onChange={(event) => setSetDefault(event.currentTarget.checked)}
          />
          Set as default model after adding
        </label>

        {/* Install */}
        <Button
          onClick={handleInstall}
          disabled={props.busy || pulling || !activeModelId || ollamaStatus !== "running"}
        >
          {props.busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
          Add {activeModelId || "model"} to workspace
        </Button>

        {props.status ? (
          <div className="rounded-xl border border-green-6 bg-green-2 px-3 py-2 text-xs text-green-11">
            {props.status}
          </div>
        ) : null}
        {props.error ? (
          <div className="rounded-xl border border-red-6 bg-red-2 px-3 py-2 text-xs text-red-11">
            {props.error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
