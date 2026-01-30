import { CheckCircle2, X } from "lucide-solid";
import type { ProviderListItem } from "../types";
import { createMemo, For, Show } from "solid-js";

import Button from "./button";

type ProviderAuthMethod = { type: "oauth" | "api"; label: string };
type ProviderAuthEntry = {
  id: string;
  name: string;
  methods: ProviderAuthMethod[];
  connected: boolean;
};

const PROVIDER_LABELS: Record<string, string> = {
  opencode: "OpenCode",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
};

export type ProviderAuthModalProps = {
  open: boolean;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  providers: ProviderListItem[];
  connectedProviderIds: string[];
  authMethods: Record<string, ProviderAuthMethod[]>;
  onSelect: (providerId: string) => void;
  onClose: () => void;
};

export default function ProviderAuthModal(props: ProviderAuthModalProps) {
  const formatProviderName = (id: string, fallback?: string) => {
    const named = fallback?.trim();
    if (named) return named;

    const normalized = id.trim();
    const mapped = PROVIDER_LABELS[normalized.toLowerCase()];
    if (mapped) return mapped;

    const cleaned = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) return id;

    return cleaned
      .split(" ")
      .filter(Boolean)
      .map((word) => {
        if (/\d/.test(word) || word.length <= 3) {
          return word.toUpperCase();
        }
        const lower = word.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(" ");
  };

  const entries = createMemo<ProviderAuthEntry[]>(() => {
    const methods = props.authMethods ?? {};
    const connected = new Set(props.connectedProviderIds ?? []);
    const providers = props.providers ?? [];

    return Object.keys(methods)
      .map((id): ProviderAuthEntry => {
        const provider = providers.find((item) => item.id === id);
        return {
          id,
          name: formatProviderName(id, provider?.name),
          methods: methods[id] ?? [],
          connected: connected.has(id),
        };
      })
      .sort((a, b) => {
        const aIsOpencode = a.id === "opencode";
        const bIsOpencode = b.id === "opencode";
        if (aIsOpencode !== bIsOpencode) return aIsOpencode ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  });

  const methodLabel = (method: ProviderAuthMethod) =>
    method.label || (method.type === "oauth" ? "OAuth" : "API key");

  const actionDisabled = () => props.loading || props.submitting;

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 bg-gray-1/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
        <div class="bg-gray-2 border border-gray-6/70 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col">
          <div class="px-6 pt-6 pb-4 border-b border-gray-6/50 flex items-start justify-between gap-4">
            <div>
              <h3 class="text-lg font-semibold text-gray-12">Connect providers</h3>
              <p class="text-sm text-gray-11 mt-1">Sign in to services you want OpenWork to use.</p>
            </div>
            <Button
              variant="ghost"
              class="!p-2 rounded-full"
              onClick={props.onClose}
              aria-label="Close"
            >
              <X size={16} />
            </Button>
          </div>

          <div class="px-6 py-4 flex flex-col gap-4 min-h-0">
            <div class="min-h-[36px]">
              <Show
                when={props.error}
                fallback={
                  <Show when={props.loading}>
                    <div class="rounded-xl border border-gray-6 bg-gray-1/60 px-4 py-3 text-sm text-gray-10 animate-pulse">
                      Loading providers...
                    </div>
                  </Show>
                }
              >
                <div class="rounded-xl border border-red-7/30 bg-red-1/40 px-3 py-2 text-xs text-red-11">
                  {props.error}
                </div>
              </Show>
            </div>

            <Show when={!props.loading}>
              <div class="flex-1 space-y-2 overflow-y-auto pr-1 -mr-1">
                <Show
                  when={entries().length}
                  fallback={<div class="text-sm text-gray-10">No providers available.</div>}
                >
                  <For each={entries()}>
                    {(entry) => (
                      <button
                        type="button"
                        class="w-full rounded-xl border border-gray-6 bg-gray-1/40 px-4 py-3 text-left transition-colors hover:bg-gray-1/70 disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={actionDisabled()}
                        onClick={() => props.onSelect(entry.id)}
                      >
                        <div class="flex items-center justify-between gap-3">
                          <div class="min-w-0">
                            <div class="text-sm font-medium text-gray-12 truncate">{entry.name}</div>
                            <div class="text-[11px] text-gray-8 font-mono truncate">{entry.id}</div>
                          </div>
                          <div class="flex items-center justify-end gap-2 shrink-0 min-w-[108px]">
                            <Show
                              when={entry.connected}
                              fallback={<span class="text-xs text-gray-9">Connect</span>}
                            >
                              <div class="flex items-center gap-1 text-[11px] text-green-11 bg-green-7/10 border border-green-7/20 px-2 py-1 rounded-full">
                                <CheckCircle2 size={12} />
                                Connected
                              </div>
                            </Show>
                          </div>
                        </div>
                        <div class="mt-2 flex flex-wrap gap-2">
                          <For each={entry.methods}>
                            {(method) => (
                              <span
                                class={`text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded-full border ${
                                  method.type === "oauth"
                                    ? "bg-indigo-7/15 text-indigo-11 border-indigo-7/30"
                                    : "bg-gray-3 text-gray-11 border-gray-6"
                                }`}
                              >
                                {methodLabel(method)}
                              </span>
                            )}
                          </For>
                        </div>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>

          <div class="px-6 pt-4 pb-6 border-t border-gray-6/50 flex flex-col gap-3">
            <div class="min-h-[16px] text-xs text-gray-10">
              <Show when={props.submitting}>Opening authentication...</Show>
            </div>
            <div class="text-xs text-gray-9">
              OAuth providers open in your browser. API keys live in <span class="font-mono">opencode.json</span>. Use{" "}
              <span class="font-mono">/models</span> to pick a default.
            </div>
            <Button variant="ghost" onClick={props.onClose} disabled={actionDisabled()}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
