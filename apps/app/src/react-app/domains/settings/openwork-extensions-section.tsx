/** @jsxImportSource react */
import { Cpu } from "lucide-react";

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

export function OpenWorkExtensionsSection(props: OpenWorkExtensionsSectionProps) {
  return (
    <details className="group" open>
      <summary className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-2 text-sm font-medium text-dls-secondary transition-colors hover:text-dls-text">
        <Cpu size={14} />
        <span>OpenWork Extensions</span>
      </summary>
      <div className="mt-3 grid gap-3">
        <OpenAiImageExtensionCard {...props.openAiImageExtension} showOpenPlugins={false} />
        {LOCAL_PROVIDER_EXTENSIONS.map((extension) => (
          <LocalProviderExtensionCard
            key={extension.id}
            extension={extension}
            installed={props.localProviderExtensions.connectedProviderIds.includes(extension.id)}
            busy={props.localProviderExtensions.busy}
            status={props.localProviderExtensions.status}
            error={props.localProviderExtensions.error}
            onInstall={props.localProviderExtensions.onInstall}
          />
        ))}
      </div>
    </details>
  );
}
