/** @jsxImportSource react */
import { useState } from "react";
import { Image, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextInput } from "../../design-system/text-input";
import { surfaceCardClass } from "../workspace/modal-styles";
import { registerExtensionConfig } from "./extension-registry";

export type OpenAiImageGenConfigProps = {
  busy: boolean;
  status: string | null;
  error: string | null;
  envKeyDetected: boolean;
  onInstall: (apiKey: string) => void | Promise<void>;
  onTestGenerate: (input: { apiKey: string; prompt: string }) => void | Promise<void>;
};

registerExtensionConfig("openai-image-gen", (ctx) => (
  <OpenAiImageGenConfig
    busy={ctx.imageExtension.busy}
    status={ctx.imageExtension.status}
    error={ctx.imageExtension.error}
    envKeyDetected={ctx.imageExtension.envKeyDetected}
    onInstall={ctx.imageExtension.onInstall}
    onTestGenerate={ctx.imageExtension.onTestGenerate}
  />
));

export function OpenAiImageGenConfig(props: OpenAiImageGenConfigProps) {
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState(
    "A friendly robot owl holding a paintbrush, teal neon UI frame, high contrast",
  );
  const canSubmit = Boolean(apiKey.trim());

  return (
    <div className="space-y-4">
      <div className={`${surfaceCardClass} space-y-4 p-4`}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary">
          Configuration
        </div>

        {props.envKeyDetected ? (
          <div className="rounded-xl border border-amber-6 bg-amber-2 px-3 py-2 text-xs text-amber-11">
            <div className="font-medium">OPENAI_API_KEY detected in environment</div>
            <div className="mt-1">
              The OpenAI provider is already connected via an environment variable. The key you set here in the extension config will take precedence for image generation.
            </div>
          </div>
        ) : null}

        <TextInput
          label="OpenAI API key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
          placeholder="sk-..."
          hint="Stored in the extension config. Takes precedence over OPENAI_API_KEY environment variable."
        />

        <TextInput
          label="Test prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          placeholder="Describe an image..."
        />

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void props.onInstall(apiKey)}
            disabled={props.busy || !canSubmit}
          >
            {props.busy ? <Loader2 className="size-4 animate-spin" /> : <Image className="size-4" />}
            Install
          </Button>
          <Button
            variant="outline"
            onClick={() => void props.onTestGenerate({ apiKey, prompt })}
            disabled={props.busy || !canSubmit || !prompt.trim()}
          >
            Generate test image
          </Button>
        </div>

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
