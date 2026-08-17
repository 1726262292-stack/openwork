"use client";

import * as React from "react";
import { ChevronDown, Settings2 } from "lucide-react";

import type { ModelOption, ModelRef } from "@/app/types";
import { ProviderIcon } from "@/react-app/design-system/provider-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/react-app/shell/workspace-provider";
import { useCheckDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import {
  OPENWORK_MODELS_PROVIDER_ID,
  OPENWORK_MODELS_PROVIDER_NAME,
} from "@/react-app/domains/cloud/openwork-models-promo";
import { getConnectedProviderItems, useProviderListQuery } from "@/react-app/infra/provider-list-query";
import { filterEntitledModelOptions } from "@/react-app/domains/connections/provider-auth/provider-policy";
import {
  filterCloudManagedModelOptions,
  mergeModelOptions,
} from "@/react-app/domains/connections/provider-auth/assigned-model-options";
import { isCloudManagedProviderKey } from "@/react-app/domains/connections/provider-auth/cloud-provider-config";
import {
  Command,
  CommandCollection,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { openModelPickerEvent, openProviderAuthEvent } from "@/react-app/shell/new-providers-listener";
import { newProvidersEvent } from "@/app/lib/provider-events";

/** Shown with their logos when no keys are connected yet. */
const SUGGESTED_KEY_PROVIDERS = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai", name: "OpenAI" },
  { id: "google", name: "Google" },
];

function getProviderDisplayName(providerId: string) {
  return providerId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function useModelOptions(
  open: boolean,
  fallbackOptions: readonly ModelOption[],
  cloudProvidersEnabled: boolean,
) {
  const { client, opencodeBaseUrl, selectedWorkspaceRoot } = useWorkspace();
  const checkDesktopRestriction = useCheckDesktopRestriction();

  const { data, refetch } = useProviderListQuery({
    client,
    baseUrl: opencodeBaseUrl,
    directory: selectedWorkspaceRoot,
    enabled: Boolean(client),
  });

  React.useEffect(() => {
    if (!open || !client) return;
    void refetch();
  }, [client, open, refetch]);

  React.useEffect(() => {
    if (!client) return;
    const handler = () => {
      void refetch();
    };
    window.addEventListener(newProvidersEvent, handler);
    return () => window.removeEventListener(newProvidersEvent, handler);
  }, [client, refetch]);

  // Apply org-level restrictions (dev #1505) on top of the raw model list
  // so the picker never surfaces blocked options:
  //   - `allowZenModel` hides the built-in OpenCode provider entries when false
  //   - `allowCustomProviders` keeps org-managed providers, plus Zen when allowed.
  return React.useMemo(() => {
    const restrictToCloud = checkDesktopRestriction({
      restriction: "allowCustomProviders",
    });

    const options = getConnectedProviderItems(data)
      .flatMap((provider) =>
        Object.entries(provider.models).map(([id, model]) => ({
          providerID: provider.id,
          modelID: id,
          title: model.name,
          description: provider.name,
          behaviorTitle: "Reasoning",
          behaviorLabel: "Default",
          behaviorDescription: "",
          behaviorValue: null,
          isFree: false,
        })),
      );

    return filterEntitledModelOptions(filterCloudManagedModelOptions(
      mergeModelOptions(options, fallbackOptions),
      cloudProvidersEnabled,
    ), {
      restrictToCloud,
      checkRestriction: checkDesktopRestriction,
    });
  }, [checkDesktopRestriction, cloudProvidersEnabled, data, fallbackOptions]);
}

type ModelSelectItem = {
  id: string;
  option: ModelOption;
};

type ModelSelectGroup = {
  value: string;
  items: ModelSelectItem[];
};

function groupByProvider(modelOptions: ModelOption[]): ModelSelectGroup[] {
  const groups = new Map<string, ModelSelectItem[]>();

  for (const option of modelOptions) {
    const providerLabel = option.description ?? getProviderDisplayName(option.providerID);
    const item: ModelSelectItem = {
      id: `${option.providerID}:${option.modelID}`,
      option,
    };
    const existing = groups.get(providerLabel);

    if (existing) {
      existing.push(item);
      continue;
    }

    groups.set(providerLabel, [item]);
  }

  return [...groups.entries()]
    .map(([providerLabel, options]) => ({
      value: providerLabel,
      items: [...options].sort((a, b) => a.option.title.localeCompare(b.option.title)),
    }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

function isSameModel(a: ModelRef, b: ModelRef) {
  return a.providerID === b.providerID && a.modelID === b.modelID;
}

interface ModelSelectProps {
  open: boolean;
  value: ModelRef;
  hideValue?: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (model: ModelRef) => void;
  disabled?: boolean;
  /** When set, "All models" opens the full picker scoped to this session. */
  sessionId?: string;
  /** Den/import includes OpenWork Models. Kept for callers; picker no longer upsells here. */
  openWorkModelsEntitled?: boolean;
  /** The server is waiting to reload this workspace with OpenWork Models. */
  openWorkModelsSyncing?: boolean;
  /** Member-scoped models available before a workspace OpenCode client exists. */
  fallbackOptions?: readonly ModelOption[];
}

export function ModelSelect({
  open,
  value,
  hideValue = false,
  onOpenChange,
  onChange,
  disabled = false,
  sessionId,
  openWorkModelsSyncing = false,
  fallbackOptions = [],
}: ModelSelectProps) {
  const [search, setSearch] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const denAuth = useDenAuth();
  const modelOptions = useModelOptions(open, fallbackOptions, denAuth.isSignedIn);
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const canAddProviders = !checkDesktopRestriction({ restriction: "allowCustomProviders" });

  const focusSearchInput = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const input = searchInputRef.current;

      if (!input) {
        return;
      }

      input.focus();
      input.select();
    });
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    focusSearchInput();
  }, [focusSearchInput, open]);

  const selectedOption = modelOptions?.find((option) =>
    isSameModel(value, {
      providerID: option.providerID,
      modelID: option.modelID,
    }),
  );

  const groups = React.useMemo(() => groupByProvider(modelOptions), [modelOptions]);

  const handleSelect = (option: ModelOption) => {
    onChange({ providerID: option.providerID, modelID: option.modelID });
    setSearch("");
    onOpenChange(false);
  };

  // Providers the user connected with their own key — OpenCode Zen and
  // OpenWork Models are managed for them, so they never count as "your keys".
  const keyProviders = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const option of modelOptions) {
      const id = option.providerID.trim().toLowerCase();
      if (!id || id === "opencode" || id === OPENWORK_MODELS_PROVIDER_ID) continue;
      if (seen.has(id)) continue;
      seen.set(id, option.description ?? getProviderDisplayName(option.providerID));
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [modelOptions]);

  const hasKeyProviders = keyProviders.length > 0;
  const keyProviderPreview = hasKeyProviders
    ? keyProviders.slice(0, 3)
    : SUGGESTED_KEY_PROVIDERS;

  const handleConnectProvider = React.useCallback(() => {
    onOpenChange(false);
    setSearch("");
    window.dispatchEvent(new Event(openProviderAuthEvent));
  }, [onOpenChange]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);

        if (!nextOpen) {
          setSearch("");
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              type="button"
              disabled={disabled}
              aria-label="Change model"
              aria-keyshortcuts="Meta+Alt+/"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12 disabled:pointer-events-none disabled:opacity-60"
            />
          }
        >
          <span className="max-w-48 truncate">
            {hideValue || (!denAuth.isSignedIn && isCloudManagedProviderKey(value.providerID))
              ? "Select model"
              : (selectedOption?.title ?? value.modelID ?? "Select model")}
          </span>
          <ChevronDown className="h-3 w-3" />
        </TooltipTrigger>
        <TooltipContent>
          Change model
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="h-80 max-h-(--available-height) w-72 gap-0 overflow-hidden p-px **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-0.5"
        align="start"
        initialFocus={false}
      >
        <Command items={groups} value={search} onValueChange={setSearch}>
          <CommandHeader>
            <CommandInput
              ref={searchInputRef}
              placeholder="Search models..."
            />
          </CommandHeader>
          <CommandEmpty>No models found.</CommandEmpty>
          {openWorkModelsSyncing ? (
            <div className="mx-1 mb-1 flex items-center gap-2 rounded-md border border-amber-6/60 bg-amber-2/40 px-2 py-1.5">
              <ProviderIcon
                providerId={OPENWORK_MODELS_PROVIDER_ID}
                providerName={OPENWORK_MODELS_PROVIDER_NAME}
                className="size-3.5 shrink-0 text-amber-11"
                size={14}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {OPENWORK_MODELS_PROVIDER_NAME}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  Included — pending workspace reload…
                </span>
              </span>
            </div>
          ) : null}
          <CommandList>
            {(group: ModelSelectGroup) => (
              <CommandGroup
                key={group.value}
                items={group.items}
              >
                <CommandGroupLabel>
                  {group.value}
                </CommandGroupLabel>
                <CommandCollection>
                  {(item: ModelSelectItem) => {
                    const option = item.option;
                    return (
                      <CommandItem
                        className="gap-2"
                        key={item.id}
                        value={`${option.providerID}:${option.modelID} ${option.title} ${option.description ?? ""}`}
                        onClick={() => handleSelect(option)}
                        data-checked={isSameModel(value, option)}
                      >
                        <ProviderIcon
                          providerId={option.providerID}
                          providerName={option.description}
                          className="size-3.5 opacity-70"
                          size={14}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-foreground">
                            {option.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {option.description ??
                              getProviderDisplayName(option.providerID)}
                          </span>
                        </span>
                      </CommandItem>
                    );
                  }}
                </CommandCollection>
              </CommandGroup>
            )}
          </CommandList>
          {/* Your API keys → provider configuration. One slot, one action: the
              label reflects whether any keys are connected yet. */}
          {canAddProviders ? (
            <div className="border-t border-border p-1">
              <div className="flex items-baseline px-2 pb-0.5 pt-1 text-xs text-muted-foreground">
                Your API keys
              </div>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={handleConnectProvider}
              >
                <span className="flex shrink-0 items-center">
                  {keyProviderPreview.map((provider, index) => (
                    <span
                      key={provider.id}
                      className="flex size-[18px] items-center justify-center overflow-hidden rounded-[6px] border border-border bg-background"
                      style={index === 0 ? undefined : { marginLeft: "-5px" }}
                    >
                      <ProviderIcon providerId={provider.id} providerName={provider.name} size={12} />
                    </span>
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {keyProviderPreview.map((provider) => provider.name).join(", ")}
                  {!hasKeyProviders || keyProviders.length > keyProviderPreview.length ? "…" : ""}
                </span>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {hasKeyProviders ? "Connect more providers" : "Add your keys"}
                </span>
              </button>
            </div>
          ) : null}
          {/* Link to full model picker */}
          <div className="border-t border-border px-2 py-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                onOpenChange(false);
                setSearch("");
                window.dispatchEvent(new CustomEvent(openModelPickerEvent, sessionId ? { detail: { sessionId } } : undefined));
              }}
            >
              <Settings2 className="size-3.5" />
              All models
            </button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
