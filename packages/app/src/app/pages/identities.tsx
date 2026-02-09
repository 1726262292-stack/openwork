import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import { HardDrive, MessageCircle, RefreshCcw, Shield } from "lucide-solid";

import Button from "../components/button";
import { createOpenworkServerClient, OpenworkServerError } from "../lib/openwork-server";
import type {
  OpenworkOwpenbotHealthSnapshot,
  OpenworkOwpenbotIdentityItem,
  OpenworkOwpenbotSlackIdentitiesResult,
  OpenworkOwpenbotTelegramIdentitiesResult,
  OpenworkServerSettings,
  OpenworkServerStatus,
} from "../lib/openwork-server";
import type { OpenworkServerInfo } from "../lib/tauri";

export type IdentitiesViewProps = {
  busy: boolean;
  openworkServerStatus: OpenworkServerStatus;
  openworkServerUrl: string;
  openworkServerSettings: OpenworkServerSettings;
  openworkServerWorkspaceId: string | null;
  openworkServerHostInfo: OpenworkServerInfo | null;
  developerMode: boolean;
};

function formatRequestError(error: unknown): string {
  if (error instanceof OpenworkServerError) {
    return `${error.message} (${error.status})`;
  }
  return error instanceof Error ? error.message : String(error);
}

function isOwpenbotSnapshot(value: unknown): value is OpenworkOwpenbotHealthSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ok === "boolean" &&
    typeof record.opencode === "object" &&
    typeof record.channels === "object" &&
    typeof record.config === "object"
  );
}

function isOwpenbotIdentities(value: unknown): value is { ok: boolean; items: OpenworkOwpenbotIdentityItem[] } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.ok === "boolean" && Array.isArray(record.items);
}

export default function IdentitiesView(props: IdentitiesViewProps) {
  const [refreshing, setRefreshing] = createSignal(false);
  const [lastUpdatedAt, setLastUpdatedAt] = createSignal<number | null>(null);

  const [health, setHealth] = createSignal<OpenworkOwpenbotHealthSnapshot | null>(null);
  const [healthError, setHealthError] = createSignal<string | null>(null);

  const [telegramIdentities, setTelegramIdentities] = createSignal<OpenworkOwpenbotIdentityItem[]>([]);
  const [telegramIdentitiesError, setTelegramIdentitiesError] = createSignal<string | null>(null);

  const [slackIdentities, setSlackIdentities] = createSignal<OpenworkOwpenbotIdentityItem[]>([]);
  const [slackIdentitiesError, setSlackIdentitiesError] = createSignal<string | null>(null);

  const [telegramToken, setTelegramToken] = createSignal("");
  const [telegramEnabled, setTelegramEnabled] = createSignal(true);
  const [telegramSaving, setTelegramSaving] = createSignal(false);
  const [telegramStatus, setTelegramStatus] = createSignal<string | null>(null);
  const [telegramError, setTelegramError] = createSignal<string | null>(null);

  const [slackBotToken, setSlackBotToken] = createSignal("");
  const [slackAppToken, setSlackAppToken] = createSignal("");
  const [slackEnabled, setSlackEnabled] = createSignal(true);
  const [slackSaving, setSlackSaving] = createSignal(false);
  const [slackStatus, setSlackStatus] = createSignal<string | null>(null);
  const [slackError, setSlackError] = createSignal<string | null>(null);

  const openworkServerClient = createMemo(() => {
    const baseUrl = props.openworkServerUrl.trim();
    const localBaseUrl = props.openworkServerHostInfo?.baseUrl?.trim() ?? "";
    const hostToken = props.openworkServerHostInfo?.hostToken?.trim() ?? "";
    const clientToken = props.openworkServerHostInfo?.clientToken?.trim() ?? "";
    const settingsToken = props.openworkServerSettings.token?.trim() ?? "";

    const isLocalServer = localBaseUrl && baseUrl === localBaseUrl;
    const token = isLocalServer ? (clientToken || settingsToken) : (settingsToken || clientToken);
    if (!baseUrl || !token) return null;
    return createOpenworkServerClient({ baseUrl, token, hostToken: isLocalServer ? hostToken : undefined });
  });

  const serverReady = createMemo(() => props.openworkServerStatus === "connected" && Boolean(openworkServerClient()));
  const workspaceId = createMemo(() => props.openworkServerWorkspaceId?.trim() || "");

  let lastResetKey = "";

  const statusTone = createMemo(() => {
    if (healthError()) return "border-red-7/20 bg-red-1/40 text-red-12";
    const snapshot = health();
    if (!snapshot) return "border-gray-7/20 bg-gray-2/60 text-gray-12";
    return snapshot.ok
      ? "border-emerald-7/25 bg-emerald-1/40 text-emerald-11"
      : "border-amber-7/25 bg-amber-1/40 text-amber-12";
  });

  const statusLabel = createMemo(() => {
    if (healthError()) return "Unavailable";
    const snapshot = health();
    if (!snapshot) return "Unknown";
    return snapshot.ok ? "Running" : "Offline";
  });

  const refreshAll = async (options?: { force?: boolean }) => {
    if (refreshing() && !options?.force) return;
    if (!serverReady()) return;
    const client = openworkServerClient();
    if (!client) return;

    setRefreshing(true);
    try {
      setHealthError(null);
      setTelegramIdentitiesError(null);
      setSlackIdentitiesError(null);

      const [healthRes, tgRes, slackRes] = await Promise.all([
        client.owpenbotHealth(),
        workspaceId()
          ? client.getOwpenbotTelegramIdentities(workspaceId())
          : client.owpenbotTelegramIdentities().then((raw) => raw.json as unknown),
        workspaceId()
          ? client.getOwpenbotSlackIdentities(workspaceId())
          : client.owpenbotSlackIdentities().then((raw) => raw.json as unknown),
      ]);

      if (isOwpenbotSnapshot(healthRes.json)) {
        setHealth(healthRes.json);
      } else {
        setHealth(null);
        if (!healthRes.ok) {
          const message =
            (healthRes.json && typeof (healthRes.json as any).message === "string")
              ? String((healthRes.json as any).message)
              : `Owpenbot health unavailable (${healthRes.status})`;
          setHealthError(message);
        }
      }

      if (isOwpenbotIdentities(tgRes)) {
        setTelegramIdentities(tgRes.items ?? []);
      } else {
        setTelegramIdentities([]);
        setTelegramIdentitiesError("Telegram identities unavailable.");
      }

      if (isOwpenbotIdentities(slackRes)) {
        setSlackIdentities(slackRes.items ?? []);
      } else {
        setSlackIdentities([]);
        setSlackIdentitiesError("Slack identities unavailable.");
      }

      setLastUpdatedAt(Date.now());
    } catch (error) {
      const message = formatRequestError(error);
      setHealth(null);
      setTelegramIdentities([]);
      setSlackIdentities([]);
      setHealthError(message);
      setTelegramIdentitiesError(message);
      setSlackIdentitiesError(message);
    } finally {
      setRefreshing(false);
    }
  };

  const upsertTelegram = async () => {
    if (telegramSaving()) return;
    if (!serverReady()) return;
    const id = workspaceId();
    if (!id) return;
    const client = openworkServerClient();
    if (!client) return;

    const token = telegramToken().trim();
    if (!token) return;

    setTelegramSaving(true);
    setTelegramStatus(null);
    setTelegramError(null);
    try {
      const result = await client.upsertOwpenbotTelegramIdentity(id, { token, enabled: telegramEnabled() });
      if (result.ok) {
        const username = (result.telegram as any)?.bot?.username;
        if (username) {
          setTelegramStatus(`Saved (@${String(username)})`);
        } else {
          setTelegramStatus(result.applied === false ? "Saved (pending apply)." : "Saved.");
        }
      } else {
        setTelegramError("Failed to save.");
      }
      if (typeof result.applyError === "string" && result.applyError.trim()) {
        setTelegramError(result.applyError.trim());
      }
      setTelegramToken("");
      void refreshAll({ force: true });
    } catch (error) {
      setTelegramError(formatRequestError(error));
    } finally {
      setTelegramSaving(false);
    }
  };

  const deleteTelegram = async (identityId: string) => {
    if (telegramSaving()) return;
    if (!serverReady()) return;
    const id = workspaceId();
    if (!id) return;
    const client = openworkServerClient();
    if (!client) return;
    if (!identityId.trim()) return;

    setTelegramSaving(true);
    setTelegramStatus(null);
    setTelegramError(null);
    try {
      const result = await client.deleteOwpenbotTelegramIdentity(id, identityId);
      if (result.ok) {
        setTelegramStatus(result.applied === false ? "Deleted (pending apply)." : "Deleted.");
      } else {
        setTelegramError("Failed to delete.");
      }
      if (typeof result.applyError === "string" && result.applyError.trim()) {
        setTelegramError(result.applyError.trim());
      }
      void refreshAll({ force: true });
    } catch (error) {
      setTelegramError(formatRequestError(error));
    } finally {
      setTelegramSaving(false);
    }
  };

  const upsertSlack = async () => {
    if (slackSaving()) return;
    if (!serverReady()) return;
    const id = workspaceId();
    if (!id) return;
    const client = openworkServerClient();
    if (!client) return;

    const botToken = slackBotToken().trim();
    const appToken = slackAppToken().trim();
    if (!botToken || !appToken) return;

    setSlackSaving(true);
    setSlackStatus(null);
    setSlackError(null);
    try {
      const result = await client.upsertOwpenbotSlackIdentity(id, { botToken, appToken, enabled: slackEnabled() });
      if (result.ok) {
        setSlackStatus(result.applied === false ? "Saved (pending apply)." : "Saved.");
      } else {
        setSlackError("Failed to save.");
      }
      if (typeof result.applyError === "string" && result.applyError.trim()) {
        setSlackError(result.applyError.trim());
      }
      setSlackBotToken("");
      setSlackAppToken("");
      void refreshAll({ force: true });
    } catch (error) {
      setSlackError(formatRequestError(error));
    } finally {
      setSlackSaving(false);
    }
  };

  const deleteSlack = async (identityId: string) => {
    if (slackSaving()) return;
    if (!serverReady()) return;
    const id = workspaceId();
    if (!id) return;
    const client = openworkServerClient();
    if (!client) return;
    if (!identityId.trim()) return;

    setSlackSaving(true);
    setSlackStatus(null);
    setSlackError(null);
    try {
      const result = await client.deleteOwpenbotSlackIdentity(id, identityId);
      if (result.ok) {
        setSlackStatus(result.applied === false ? "Deleted (pending apply)." : "Deleted.");
      } else {
        setSlackError("Failed to delete.");
      }
      if (typeof result.applyError === "string" && result.applyError.trim()) {
        setSlackError(result.applyError.trim());
      }
      void refreshAll({ force: true });
    } catch (error) {
      setSlackError(formatRequestError(error));
    } finally {
      setSlackSaving(false);
    }
  };

  createEffect(() => {
    const baseUrl = props.openworkServerUrl.trim();
    const id = workspaceId();
    const nextKey = `${baseUrl}|${id}`;
    if (nextKey === lastResetKey) return;
    lastResetKey = nextKey;

    setHealth(null);
    setHealthError(null);
    setTelegramIdentities([]);
    setTelegramIdentitiesError(null);
    setSlackIdentities([]);
    setSlackIdentitiesError(null);
    setLastUpdatedAt(null);
  });

  onMount(() => {
    void refreshAll({ force: true });
    const interval = window.setInterval(() => void refreshAll(), 10_000);
    onCleanup(() => window.clearInterval(interval));
  });

  return (
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-sm font-semibold text-gray-12">Messaging identities</div>
          <div class="text-xs text-gray-9">Slack + Telegram multi-identities with identity-scoped routing.</div>
        </div>
        <Button
          variant="secondary"
          class="h-8 px-3 text-xs"
          onClick={() => refreshAll({ force: true })}
          disabled={!serverReady() || refreshing()}
        >
          <RefreshCcw size={14} class={refreshing() ? "animate-spin" : ""} />
          <span class="ml-2">Refresh</span>
        </Button>
      </div>

      <Show when={!serverReady()}>
        <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm">
          <div class="text-sm font-semibold text-gray-12">Connect to an OpenWork server</div>
          <div class="mt-1 text-xs text-gray-10">
            Identities are available when you are connected to an OpenWork host (`openwrk`).
          </div>
        </div>
      </Show>

      <Show when={serverReady()}>
        <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm space-y-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex items-center gap-2">
              <Shield size={18} class="text-gray-10" />
              <div>
                <div class="text-sm font-semibold text-gray-12">Owpenbot health</div>
                <Show when={lastUpdatedAt()}>
                  {(value) => <div class="text-[11px] text-gray-9">Updated {new Date(value()).toLocaleTimeString()}</div>}
                </Show>
              </div>
            </div>
            <span class={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone()}`}>
              {statusLabel()}
            </span>
          </div>

          <Show when={healthError()}>
            {(value) => (
              <div class="rounded-xl border border-red-7/20 bg-red-1/30 px-4 py-3 text-xs text-red-12">{value()}</div>
            )}
          </Show>

          <Show when={health()}>
            {(snapshot) => (
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="rounded-xl border border-gray-4 bg-gray-1 px-4 py-3">
                  <div class="text-[11px] text-gray-9 uppercase tracking-wide font-semibold">OpenCode</div>
                  <div class="mt-1 text-xs text-gray-12">{snapshot().opencode.healthy ? "Healthy" : "Unhealthy"}</div>
                  <div class="mt-1 text-[11px] text-gray-9 font-mono truncate">{snapshot().opencode.url}</div>
                </div>
                <div class="rounded-xl border border-gray-4 bg-gray-1 px-4 py-3">
                  <div class="text-[11px] text-gray-9 uppercase tracking-wide font-semibold">Channels</div>
                  <div class="mt-1 text-xs text-gray-12">Telegram: {snapshot().channels.telegram ? "on" : "off"}</div>
                  <div class="mt-1 text-xs text-gray-12">Slack: {snapshot().channels.slack ? "on" : "off"}</div>
                </div>
                <div class="rounded-xl border border-gray-4 bg-gray-1 px-4 py-3">
                  <div class="text-[11px] text-gray-9 uppercase tracking-wide font-semibold">Groups</div>
                  <div class="mt-1 text-xs text-gray-12">Groups enabled: {snapshot().config.groupsEnabled ? "yes" : "no"}</div>
                </div>
              </div>
            )}
          </Show>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm space-y-4">
            <div class="flex items-center gap-2">
              <MessageCircle size={18} class="text-gray-10" />
              <div>
                <div class="text-sm font-semibold text-gray-12">Telegram identities</div>
                <div class="text-xs text-gray-9">Telegram bot for this workspace.</div>
              </div>
            </div>

            <Show when={telegramIdentitiesError()}>
              {(value) => (
                <div class="rounded-xl border border-amber-7/20 bg-amber-1/30 px-4 py-3 text-xs text-amber-12">{value()}</div>
              )}
            </Show>

            <Show when={telegramIdentities().length === 0 && !telegramIdentitiesError()}>
              <div class="text-xs text-gray-10">No Telegram identities configured.</div>
            </Show>

            <Show when={telegramIdentities().length > 0}>
              <div class="divide-y divide-gray-4 rounded-xl border border-gray-4 overflow-hidden">
                <For each={telegramIdentities()}>
                  {(item) => (
                    <div class="px-4 py-3 bg-gray-1 flex items-center justify-between gap-3">
                      <div>
                        <div class="text-xs font-semibold text-gray-12">Workspace identity</div>
                        <div class="mt-0.5 text-[11px] text-gray-9">
                          <span class="font-mono">{item.id}</span> · {item.enabled ? "enabled" : "disabled"} · {item.running ? "running" : "stopped"}
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        class="h-8 px-3 text-xs"
                        disabled={telegramSaving() || item.id === "env" || !workspaceId()}
                        onClick={() => void deleteTelegram(item.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <div class="rounded-xl border border-gray-4 bg-gray-1 px-4 py-3 space-y-2">
              <div class="grid grid-cols-1 gap-2">
                <input
                  class="w-full rounded-lg border border-gray-4 bg-gray-1 px-3 py-2 text-xs text-gray-12 placeholder:text-gray-9"
                  placeholder="Telegram bot token"
                  type="password"
                  value={telegramToken()}
                  onInput={(e) => setTelegramToken(e.currentTarget.value)}
                />
              </div>

              <label class="flex items-center gap-2 text-xs text-gray-11">
                <input
                  type="checkbox"
                  checked={telegramEnabled()}
                  onChange={(e) => setTelegramEnabled(e.currentTarget.checked)}
                />
                Enabled
              </label>

              <div class="flex items-center gap-2">
                <Button
                  variant="primary"
                  class="h-8 px-3 text-xs"
                  onClick={() => void upsertTelegram()}
                  disabled={telegramSaving() || !workspaceId() || !telegramToken().trim()}
                >
                  {telegramSaving() ? "Saving..." : "Save"}
                </Button>
                <Show when={telegramStatus()}>
                  {(value) => <div class="text-[11px] text-gray-9">{value()}</div>}
                </Show>
              </div>
              <Show when={telegramError()}>
                {(value) => <div class="text-[11px] text-red-12">{value()}</div>}
              </Show>
            </div>
          </div>

          <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm space-y-4">
            <div class="flex items-center gap-2">
              <MessageCircle size={18} class="text-gray-10" />
              <div>
                <div class="text-sm font-semibold text-gray-12">Slack identities</div>
                <div class="text-xs text-gray-9">Slack app for this workspace.</div>
              </div>
            </div>

            <Show when={slackIdentitiesError()}>
              {(value) => (
                <div class="rounded-xl border border-amber-7/20 bg-amber-1/30 px-4 py-3 text-xs text-amber-12">{value()}</div>
              )}
            </Show>

            <Show when={slackIdentities().length === 0 && !slackIdentitiesError()}>
              <div class="text-xs text-gray-10">No Slack identities configured.</div>
            </Show>

            <Show when={slackIdentities().length > 0}>
              <div class="divide-y divide-gray-4 rounded-xl border border-gray-4 overflow-hidden">
                <For each={slackIdentities()}>
                  {(item) => (
                    <div class="px-4 py-3 bg-gray-1 flex items-center justify-between gap-3">
                      <div>
                        <div class="text-xs font-semibold text-gray-12">Workspace identity</div>
                        <div class="mt-0.5 text-[11px] text-gray-9">
                          <span class="font-mono">{item.id}</span> · {item.enabled ? "enabled" : "disabled"} · {item.running ? "running" : "stopped"}
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        class="h-8 px-3 text-xs"
                        disabled={slackSaving() || item.id === "env" || !workspaceId()}
                        onClick={() => void deleteSlack(item.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <div class="rounded-xl border border-gray-4 bg-gray-1 px-4 py-3 space-y-2">
              <div class="grid grid-cols-1 gap-2">
                <input
                  class="w-full rounded-lg border border-gray-4 bg-gray-1 px-3 py-2 text-xs text-gray-12 placeholder:text-gray-9"
                  placeholder="Slack bot token (xoxb-...)"
                  type="password"
                  value={slackBotToken()}
                  onInput={(e) => setSlackBotToken(e.currentTarget.value)}
                />
                <input
                  class="w-full rounded-lg border border-gray-4 bg-gray-1 px-3 py-2 text-xs text-gray-12 placeholder:text-gray-9"
                  placeholder="Slack app token (xapp-...)"
                  type="password"
                  value={slackAppToken()}
                  onInput={(e) => setSlackAppToken(e.currentTarget.value)}
                />
              </div>

              <label class="flex items-center gap-2 text-xs text-gray-11">
                <input
                  type="checkbox"
                  checked={slackEnabled()}
                  onChange={(e) => setSlackEnabled(e.currentTarget.checked)}
                />
                Enabled
              </label>

              <div class="flex items-center gap-2">
                <Button
                  variant="primary"
                  class="h-8 px-3 text-xs"
                  onClick={() => void upsertSlack()}
                  disabled={slackSaving() || !workspaceId() || !slackBotToken().trim() || !slackAppToken().trim()}
                >
                  {slackSaving() ? "Saving..." : "Save"}
                </Button>
                <Show when={slackStatus()}>
                  {(value) => <div class="text-[11px] text-gray-9">{value()}</div>}
                </Show>
              </div>
              <Show when={slackError()}>
                {(value) => <div class="text-[11px] text-red-12">{value()}</div>}
              </Show>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm space-y-3">
          <div class="flex items-center gap-2">
            <HardDrive size={18} class="text-gray-10" />
            <div>
              <div class="text-sm font-semibold text-gray-12">Routing</div>
              <div class="text-xs text-gray-9">New chats auto-bind to this workspace on first message.</div>
            </div>
          </div>
          <div class="text-xs text-gray-10">
            Advanced: reply with <span class="font-mono">/dir &lt;path&gt;</span> in Slack/Telegram to override the directory for a specific chat.
          </div>
        </div>
      </Show>
    </div>
  );
}
