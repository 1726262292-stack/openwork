/** @jsxImportSource react */
import { useState } from "react";
import { CheckCircle2, Image, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TextInput } from "../../design-system/text-input";
import { SettingsNotice } from "./settings-section";
import {
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
} from "./settings-layout";
import { OPENAI_IMAGE_MODEL } from "./openai-image-extension";

export type OpenAiImageExtensionCardProps = {
  installed: boolean;
  installBusy: boolean;
  installStatus: string | null;
  installError: string | null;
  generationBusy: boolean;
  generationStatus: string | null;
  generationError: string | null;
  onInstall: (apiKey: string) => void | Promise<void>;
  onGenerateTestImage: (input: { apiKey: string; prompt: string }) => void | Promise<void>;
  onOpenPlugins?: () => void;
  showOpenPlugins?: boolean;
};

export function OpenAiImageExtensionCard(props: OpenAiImageExtensionCardProps) {
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("A square test image for OpenWork: a friendly robot owl holding a paintbrush, teal neon UI frame, text label OPENWORK IMAGE E2E, high contrast");
  const canSubmit = Boolean(apiKey.trim());
  const canGenerate = canSubmit && Boolean(prompt.trim());

  return (
    <LayoutSectionItem className="rounded-2xl border border-dls-border bg-dls-surface p-4">
      <LayoutSectionItemHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            {props.installed ? <CheckCircle2 size={18} /> : <Image size={18} />}
          </div>
          <div className="min-w-0">
            <LayoutSectionItemTitle>OpenAI Image Gen</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>
              OpenWork extension backed by an OpenCode plugin. Generates PNG artifacts with <code>{OPENAI_IMAGE_MODEL}</code>.
            </LayoutSectionItemDescription>
          </div>
        </div>
        {props.showOpenPlugins && props.onOpenPlugins ? (
          <LayoutSectionItemHeaderActions>
            <Button variant="outline" onClick={props.onOpenPlugins}>Open plugins</Button>
          </LayoutSectionItemHeaderActions>
        ) : null}
      </LayoutSectionItemHeader>

      <TextInput
        label="OpenAI API key"
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.currentTarget.value)}
        placeholder="sk-..."
        hint="Stored through OpenWork's existing environment system as OPENAI_API_KEY. The key is not committed to project source."
      />

      <label className="block space-y-1.5 text-sm">
        <span className="text-xs font-medium text-dls-secondary">Test prompt</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          rows={4}
          className="w-full resize-none rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-sm text-dls-text shadow-sm outline-none transition-colors placeholder:text-dls-secondary focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.2)]"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void props.onInstall(apiKey)} disabled={props.installBusy || !canSubmit}>
          {props.installBusy ? <Loader2 className="size-4 animate-spin" /> : <Image className="size-4" />}
          {props.installed ? "Update extension" : "Install extension"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void props.onGenerateTestImage({ apiKey, prompt })}
          disabled={props.generationBusy || !canGenerate}
        >
          {props.generationBusy ? <Loader2 className="size-4 animate-spin" /> : <Image className="size-4" />}
          Generate test image
        </Button>
      </div>

      {props.installStatus ? <SettingsNotice>{props.installStatus}</SettingsNotice> : null}
      {props.installError ? <SettingsNotice tone="error">{props.installError}</SettingsNotice> : null}
      {props.generationStatus ? <SettingsNotice>{props.generationStatus}</SettingsNotice> : null}
      {props.generationError ? <SettingsNotice tone="error">{props.generationError}</SettingsNotice> : null}
    </LayoutSectionItem>
  );
}
