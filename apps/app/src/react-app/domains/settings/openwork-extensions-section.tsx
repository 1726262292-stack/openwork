/** @jsxImportSource react */
import { useState } from "react";
import { Bot, Image } from "lucide-react";

import { ExtensionCard } from "../../design-system/extension-card";
import { OpenAiImageExtensionCard, type OpenAiImageExtensionCardProps } from "./openai-image-extension-card";
import {
  LOCAL_PROVIDER_EXTENSIONS,
  LocalProviderExtensionCard,
  type LocalProviderInstallInput,
} from "./local-provider-extension-card";

export type OpenWorkExtensionsSectionProps = {
  openAiImageExtension: OpenAiImageExtensionCardProps;
  localProviderExtensions: {
    connectedProviderIds: string[];
    busy: boolean;
    status: string | null;
    error: string | null;
    onInstall: (input: LocalProviderInstallInput) => void | Promise<void>;
  };
};

type SelectedExtension = "openai-image-generation" | string | null;

export function OpenWorkExtensionsSection(props: OpenWorkExtensionsSectionProps) {
  const [selectedExtension, setSelectedExtension] = useState<SelectedExtension>(null);
  const selectedLocalProvider = LOCAL_PROVIDER_EXTENSIONS.find((extension) => extension.id === selectedExtension) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-dls-secondary">
          Available apps
        </h3>
        <span className="text-[11px] text-dls-secondary">One-click connect</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ExtensionCard
          name="OpenAI Image Gen"
          description="Generate image artifacts with gpt-image-2."
          fallbackIcon={Image}
          kind="plugin"
          connected={props.openAiImageExtension.installed}
          connecting={props.openAiImageExtension.installBusy || props.openAiImageExtension.generationBusy}
          actionLabel={props.openAiImageExtension.installed ? "Configure" : "Tap to connect"}
          onClick={() => setSelectedExtension("openai-image-generation")}
        />
        {LOCAL_PROVIDER_EXTENSIONS.map((extension) => (
          <ExtensionCard
            key={extension.id}
            name={extension.label}
            description={`Local model provider at ${extension.baseURL}.`}
            fallbackIcon={Bot}
            kind="plugin"
            connected={props.localProviderExtensions.connectedProviderIds.includes(extension.id)}
            connecting={props.localProviderExtensions.busy && selectedExtension === extension.id}
            actionLabel={props.localProviderExtensions.connectedProviderIds.includes(extension.id) ? "Configure" : "Tap to connect"}
            onClick={() => setSelectedExtension(extension.id)}
          />
        ))}
      </div>

      {selectedExtension === "openai-image-generation" ? (
        <OpenAiImageExtensionCard {...props.openAiImageExtension} showOpenPlugins={false} />
      ) : null}
      {selectedLocalProvider ? (
        <LocalProviderExtensionCard
          extension={selectedLocalProvider}
          installed={props.localProviderExtensions.connectedProviderIds.includes(selectedLocalProvider.id)}
          busy={props.localProviderExtensions.busy}
          status={props.localProviderExtensions.status}
          error={props.localProviderExtensions.error}
          onInstall={props.localProviderExtensions.onInstall}
        />
      ) : null}
    </div>
  );
}
