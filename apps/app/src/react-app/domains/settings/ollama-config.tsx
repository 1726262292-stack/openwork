/** @jsxImportSource react */
import { useState } from "react";
import { Bot, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextInput } from "../../design-system/text-input";
import { surfaceCardClass } from "../workspace/modal-styles";
import { OLLAMA_PROVIDER_CONFIG } from "./openai-image-extension";

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
  const [modelId, setModelId] = useState(OLLAMA_PROVIDER_CONFIG.defaultModelId);
  const [setDefault, setSetDefault] = useState(true);
  const trimmed = modelId.trim();

  return (
    <div className="space-y-4">
      <div className={`${surfaceCardClass} space-y-4 p-4`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">
          Configuration
        </div>

        <div className="rounded-xl border border-dls-border bg-dls-hover px-3 py-2 text-xs text-muted-foreground">
          <div className="font-medium text-dls-text">Before installing</div>
          <code className="mt-1 block text-dls-text">
            ollama pull {OLLAMA_PROVIDER_CONFIG.defaultModelId}
          </code>
        </div>

        <TextInput
          label="Model ID"
          value={modelId}
          onChange={(event) => setModelId(event.currentTarget.value)}
          placeholder={OLLAMA_PROVIDER_CONFIG.defaultModelId}
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
          onClick={() =>
            void props.onInstall({
              providerId: OLLAMA_PROVIDER_CONFIG.providerId,
              name: OLLAMA_PROVIDER_CONFIG.name,
              baseURL: OLLAMA_PROVIDER_CONFIG.baseURL,
              modelId: trimmed,
              modelName: trimmed,
              setDefault,
            })
          }
          disabled={props.busy || !trimmed}
        >
          {props.busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
          Install Ollama
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
