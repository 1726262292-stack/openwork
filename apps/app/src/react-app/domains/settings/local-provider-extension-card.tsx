/** @jsxImportSource react */
import { useState } from "react";
import { Bot, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextInput } from "../../design-system/text-input";
import { SettingsNotice } from "./settings-section";
import {
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemTitle,
} from "./settings-layout";

export type LocalProviderInstallInput = {
  providerId: string;
  name: string;
  baseURL: string;
  modelId: string;
  modelName: string;
  setDefault: boolean;
};

export type LocalProviderExtensionConfig = {
  id: string;
  label: string;
  name: string;
  baseURL: string;
  defaultModelId: string;
  setup: string;
};

export const LOCAL_PROVIDER_EXTENSIONS: LocalProviderExtensionConfig[] = [
  {
    id: "ollama",
    label: "Ollama",
    name: "Ollama (local)",
    baseURL: "http://localhost:11434/v1",
    defaultModelId: "qwen2.5-coder:7b",
    setup: "ollama pull qwen2.5-coder:7b",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    name: "LM Studio (local)",
    baseURL: "http://127.0.0.1:1234/v1",
    defaultModelId: "google/gemma-3n-e4b",
    setup: "Start the LM Studio local server and load a model.",
  },
  {
    id: "llama.cpp",
    label: "llama.cpp",
    name: "llama-server (local)",
    baseURL: "http://127.0.0.1:8080/v1",
    defaultModelId: "qwen3-coder:a3b",
    setup: "Start llama-server on port 8080 with your model.",
  },
];

export type LocalProviderExtensionCardProps = {
  extension: LocalProviderExtensionConfig;
  installed: boolean;
  busy: boolean;
  status: string | null;
  error: string | null;
  onInstall: (input: LocalProviderInstallInput) => void | Promise<void>;
};

export function LocalProviderExtensionCard(props: LocalProviderExtensionCardProps) {
  const [modelId, setModelId] = useState(props.extension.defaultModelId);
  const [setDefault, setSetDefault] = useState(true);
  const trimmedModelId = modelId.trim();

  return (
    <LayoutSectionItem className="rounded-2xl border border-dls-border bg-dls-surface p-4">
      <LayoutSectionItemHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            {props.installed ? <CheckCircle2 size={18} /> : <Bot size={18} />}
          </div>
          <div className="min-w-0">
            <LayoutSectionItemTitle>{props.extension.label}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>
              Local OpenAI-compatible provider at <code>{props.extension.baseURL}</code>.
            </LayoutSectionItemDescription>
          </div>
        </div>
      </LayoutSectionItemHeader>

      <div className="rounded-xl border border-dls-border bg-dls-hover px-3 py-2 text-xs text-muted-foreground">
        <div className="font-medium text-dls-text">Before installing</div>
        <code className="mt-1 block text-dls-text">{props.extension.setup}</code>
      </div>

      <TextInput
        label="Model ID"
        value={modelId}
        onChange={(event) => setModelId(event.currentTarget.value)}
        placeholder={props.extension.defaultModelId}
      />

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={setDefault}
          onChange={(event) => setSetDefault(event.currentTarget.checked)}
        />
        Set as default model after adding
      </label>

      <Button
        onClick={() => void props.onInstall({
          providerId: props.extension.id,
          name: props.extension.name,
          baseURL: props.extension.baseURL,
          modelId: trimmedModelId,
          modelName: trimmedModelId,
          setDefault,
        })}
        disabled={props.busy || !trimmedModelId}
      >
        {props.busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
        {props.installed ? "Update" : "Install"} {props.extension.label}
      </Button>

      {props.status ? <SettingsNotice>{props.status}</SettingsNotice> : null}
      {props.error ? <SettingsNotice tone="error">{props.error}</SettingsNotice> : null}
    </LayoutSectionItem>
  );
}
