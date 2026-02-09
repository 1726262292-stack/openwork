import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";

import Button from "../components/button";
import { HardDrive, MessageCircle, PlugZap, RefreshCcw, Shield, Smartphone } from "lucide-solid";
import { createOpenworkServerClient, OpenworkServerError } from "../lib/openwork-server";
import type {
  OpenworkOwpenbotBindingsResult,
  OpenworkOwpenbotHealthSnapshot,
  OpenworkOwpenbotTelegramInfo,
  OpenworkOwpenbotWhatsAppEnabledResult,
  OpenworkOwpenbotWhatsAppQrResult,
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

function isOwpenbotBindings(value: unknown): value is OpenworkOwpenbotBindingsResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.ok === "boolean" && Array.isArray(record.items);
}

function isWhatsAppEnabled(value: unknown): value is OpenworkOwpenbotWhatsAppEnabledResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.ok === "boolean" && typeof record.enabled === "boolean";
}

function isWhatsAppQr(value: unknown): value is OpenworkOwpenbotWhatsAppQrResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.ok === "boolean" && typeof record.qr === "string";
}

export default function IdentitiesView(props: IdentitiesViewProps) {
  const [refreshing, setRefreshing] = createSignal(false);
  const [lastUpdatedAt, setLastUpdatedAt] = createSignal<number | null>(null);

  const [health, setHealth] = createSignal<OpenworkOwpenbotHealthSnapshot | null>(null);
  const [healthError, setHealthError] = createSignal<string | null>(null);

  const [bindings, setBindings] = createSignal<OpenworkOwpenbotBindingsResult["items"]>([]);
  const [bindingsError, setBindingsError] = createSignal<string | null>(null);

  const [whatsAppEnabled, setWhatsAppEnabled] = createSignal<boolean | null>(null);
  const [whatsAppEnabledError, setWhatsAppEnabledError] = createSignal<string | null>(null);
  const [whatsAppQr, setWhatsAppQr] = createSignal<string | null>(null);
  const [whatsAppQrError, setWhatsAppQrError] = createSignal<string | null>(null);
  const [whatsAppQrBusy, setWhatsAppQrBusy] = createSignal(false);

  const [telegramToken, setTelegramToken] = createSignal("");
  const [telegramSaving, setTelegramSaving] = createSignal(false);
  const [telegramStatus, setTelegramStatus] = createSignal<string | null>(null);
  const [telegramError, setTelegramError] = createSignal<string | null>(null);
  const [telegramInfo, setTelegramInfo] = createSignal<OpenworkOwpenbotTelegramInfo | null>(null);

  const [slackBotToken, setSlackBotToken] = createSignal("");
  const [slackAppToken, setSlackAppToken] = createSignal("");
  const [slackSaving, setSlackSaving] = createSignal(false);
  const [slackStatus, setSlackStatus] = createSignal<string | null>(null);
  const [slackError, setSlackError] = createSignal<string | null>(null);

  const openworkServerClient = createMemo(() => {
    const baseUrl = props.openworkServerUrl.trim();
    const localBaseUrl = props.openworkServerHostInfo?.baseUrl?.trim() ?? "";
    const hostToken = props.openworkServerHostInfo?.hostToken?.trim() ?? "";
    const clientToken = props.openworkServerHostInfo?.clientToken?.trim() ?? "";
    const settingsToken = props.openworkServerSettings.token?.trim() ?? "";

    // Use clientToken only when connecting to the local server; use settingsToken for remote.
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
    return snapshot.ok ? "border-emerald-7/25 bg-emerald-1/40 text-emerald-11" : "border-amber-7/25 bg-amber-1/40 text-amber-12";
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
      setBindingsError(null);
      setWhatsAppEnabledError(null);

      const [healthRes, bindingsRes, enabledRes, telegramRes] = await Promise.all([
        client.owpenbotHealth(),
        client.owpenbotBindings(),
        client.owpenbotWhatsAppEnabled(),
        workspaceId() ? client.getOwpenbotTelegram(workspaceId()) : Promise.resolve(null),
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

      if (isOwpenbotBindings(bindingsRes.json)) {
        setBindings(bindingsRes.json.items);
      } else {
        setBindings([]);
        if (!bindingsRes.ok) {
          const message =
            (bindingsRes.json && typeof (bindingsRes.json as any).message === "string")
              ? String((bindingsRes.json as any).message)
              : `Bindings unavailable (${bindingsRes.status})`;
          setBindingsError(message);
        }
      }

      if (isWhatsAppEnabled(enabledRes.json)) {
        setWhatsAppEnabled(enabledRes.json.enabled);
      } else {
        setWhatsAppEnabled(null);
        if (!enabledRes.ok) {
          const message =
            (enabledRes.json && typeof (enabledRes.json as any).message === "string")
              ? String((enabledRes.json as any).message)
              : `WhatsApp status unavailable (${enabledRes.status})`;
          setWhatsAppEnabledError(message);
        }
      }

      if (telegramRes && typeof telegramRes === "object") {
        const info = telegramRes as OpenworkOwpenbotTelegramInfo;
        setTelegramInfo(info.ok ? info : null);
      }

      setLastUpdatedAt(Date.now());
    } catch (error) {
      setHealth(null);
      setBindings([]);
      setWhatsAppEnabled(null);
      setWhatsAppQr(null);
      const message = formatRequestError(error);
      setHealthError(message);
      setBindingsError(message);
      setWhatsAppEnabledError(message);
      setTelegramInfo(null);
    } finally {
      setRefreshing(false);
    }
  };

  const fetchWhatsAppQr = async () => {
    if (whatsAppQrBusy()) return;
    if (!serverReady()) return;
    const client = openworkServerClient();
    if (!client) return;

    setWhatsAppQrBusy(true);
    setWhatsAppQrError(null);
    try {
      const res = await client.owpenbotWhatsAppQr("ascii");
      if (isWhatsAppQr(res.json)) {
        setWhatsAppQr(res.json.qr);
        return;
      }
      const message =
        (res.json && typeof (res.json as any).message === "string")
          ? String((res.json as any).message)
          : `QR unavailable (${res.status})`;
      setWhatsAppQrError(message);
    } catch (error) {
      setWhatsAppQrError(formatRequestError(error));
    } finally {
      setWhatsAppQrBusy(false);
    }
  };

  const saveTelegramToken = async () => {
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
      const result = await client.setOwpenbotTelegramToken(id, token);
      if (result.ok && result.telegram?.configured && result.telegram.enabled) {
        setTelegramStatus(result.applied === false ? "Token saved (pending apply)." : "Telegram connected.");
      } else if (result.ok) {
        setTelegramStatus("Token saved.");
      } else {
        setTelegramError("Failed to save token.");
      }
      if ((result.telegram as any)?.bot?.username) {
        setTelegramStatus(`Telegram connected (@${(result.telegram as any).bot.username}).`);
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

  const disconnectTelegram = async () => {
    if (telegramSaving()) return;
    if (!serverReady()) return;
    const id = workspaceId();
    if (!id) return;
    const client = openworkServerClient();
    if (!client) return;

    setTelegramSaving(true);
    setTelegramStatus(null);
    setTelegramError(null);
    try {
      const result = await client.setOwpenbotTelegramEnabled(id, false, { clearToken: true });
      if (result.ok) {
        setTelegramStatus(result.applied === false ? "Disconnected (pending apply)." : "Disconnected.");
      } else {
        setTelegramError("Failed to disconnect.");
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

  const saveSlackTokens = async () => {
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
      const result = await client.setOwpenbotSlackTokens(id, botToken, appToken);
      if (result.ok && result.slack?.configured && result.slack.enabled) {
        setSlackStatus(result.applied === false ? "Tokens saved (pending apply)." : "Slack connected.");
      } else if (result.ok) {
        setSlackStatus("Tokens saved.");
      } else {
        setSlackError("Failed to save tokens.");
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

  createEffect(() => {
    const baseUrl = props.openworkServerUrl.trim();
    const id = workspaceId();
    const nextKey = `${baseUrl}|${id}`;
    if (nextKey === lastResetKey) return;
    lastResetKey = nextKey;

    setHealth(null);
    setHealthError(null);
    setBindings([]);
    setBindingsError(null);
    setWhatsAppEnabled(null);
    setWhatsAppEnabledError(null);
    setWhatsAppQr(null);
    setWhatsAppQrError(null);
    setTelegramInfo(null);
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
          <div class="text-xs text-gray-9">Slack, Telegram, WhatsApp routing + status (REST-driven).</div>
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
                  {(value) => (
                    <div class="text-[11px] text-gray-9">Updated {new Date(value()).toLocaleTimeString()}</div>
                  )}
                </Show>
              </div>
            </div>
            <span class={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone()}`}>
              {statusLabel()}
            </span>
          </div>

          <Show when={healthError()}>
            {(value) => (
              <div class="rounded-xl border border-red-7/20 bg-red-1/30 px-4 py-3 text-xs text-red-12">
                {value()}
              </div>
            )}
          </Show>

          <Show when={health()}>
            {(snapshot) => (
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="rounded-xl border border-gray-4 bg-gray-1 px-4 py-3">
                  <div class="text-[11px] text-gray-9 uppercase tracking-wide font-semibold">OpenCode</div>
                  <div class="mt-1 text-xs text-gray-12">
                    {snapshot().opencode.healthy ? "Healthy" : "Unhealthy"}
                  </div>
                  <div class="mt-1 text-[11px] text-gray-9 font-mono truncate">{snapshot().opencode.url}</div>
                </div>
                <div class="rounded-xl border border-gray-4 bg-gray-1 px-4 py-3">
                  <div class="text-[11px] text-gray-9 uppercase tracking-wide font-semibold">Channels</div>
                  <div class="mt-1 text-xs text-gray-12">
                    Telegram: {snapshot().channels.telegram ? "on" : "off"}
                  </div>
                  <div class="mt-1 text-xs text-gray-12">
                    Slack: {snapshot().channels.slack ? "on" : "off"}
                  </div>
                  <div class="mt-1 text-xs text-gray-12">
                    WhatsApp: {snapshot().channels.whatsapp ? "on" : "off"}
                  </div>
                </div>
                <div class="rounded-xl border border-gray-4 bg-gray-1 px-4 py-3">
                  <div class="text-[11px] text-gray-9 uppercase tracking-wide font-semibold">Groups</div>
                  <div class="mt-1 text-xs text-gray-12">
                    Groups enabled: {snapshot().config.groupsEnabled ? "yes" : "no"}
                  </div>
                </div>
              </div>
            )}
          </Show>
        </div>

        <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm space-y-4">
          <div class="flex items-center gap-2">
            <HardDrive size={18} class="text-gray-10" />
            <div>
              <div class="text-sm font-semibold text-gray-12">Routing (bindings)</div>
              <div class="text-xs text-gray-9">Which identity routes to which directory.</div>
            </div>
          </div>

          <Show when={bindingsError()}>
            {(value) => (
              <div class="rounded-xl border border-amber-7/20 bg-amber-1/30 px-4 py-3 text-xs text-amber-12">
                {value()}
              </div>
            )}
          </Show>

          <Show when={bindings().length === 0 && !bindingsError()}>
            <div class="text-xs text-gray-10">No bindings yet.</div>
          </Show>

          <Show when={bindings().length > 0}>
            <div class="divide-y divide-gray-4 rounded-xl border border-gray-4 overflow-hidden">
              <For each={bindings()}>
                {(item) => (
                  <div class="px-4 py-3 bg-gray-1">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="text-xs font-semibold text-gray-12">
                        {item.channel} / {item.peerId}
                      </div>
                      <Show when={typeof item.updatedAt === "number"}>
                        <div class="text-[11px] text-gray-9">{new Date(item.updatedAt as number).toLocaleString()}</div>
                      </Show>
                    </div>
                    <div class="mt-1 text-[11px] text-gray-9 font-mono break-all">{item.directory}</div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm space-y-4">
            <div class="flex items-center gap-2">
              <MessageCircle size={18} class="text-gray-10" />
              <div>
                <div class="text-sm font-semibold text-gray-12">Telegram</div>
                <div class="text-xs text-gray-9">Save bot token on the host (REST).</div>
              </div>
            </div>

            <Show when={telegramInfo()}>
              {(info) => (
                <div class="text-xs text-gray-10">
                  <span class="font-semibold text-gray-12">
                    {info().configured ? "Configured" : "Not configured"}
                  </span>
                  <span class="mx-2 text-gray-8">•</span>
                  <span>{info().enabled ? "Enabled" : "Disabled"}</span>
                  <Show when={info().bot?.username}>
                    {(u) => (
                      <>
                        <span class="mx-2 text-gray-8">•</span>
                        <span class="font-mono">@{u()}</span>
                      </>
                    )}
                  </Show>
                </div>
              )}
            </Show>
            <input
              type="password"
              value={telegramToken()}
              onInput={(e) => setTelegramToken(e.currentTarget.value)}
              placeholder="Telegram bot token"
              class="w-full rounded-xl border border-gray-5 bg-gray-1 px-3 py-2 text-sm text-gray-12 placeholder:text-gray-8 focus:outline-none focus:ring-2 focus:ring-gray-6"
            />
            <div class="flex items-center gap-2">
              <Button
                variant="primary"
                class="h-9 px-4 text-xs"
                onClick={saveTelegramToken}
                disabled={telegramSaving() || !telegramToken().trim() || !workspaceId()}
              >
                {telegramSaving() ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="outline"
                class="h-9 px-4 text-xs"
                onClick={disconnectTelegram}
                disabled={telegramSaving() || !(telegramInfo()?.configured ?? false)}
              >
                Disconnect
              </Button>
              <Show when={!workspaceId()}>
                <div class="text-[11px] text-gray-9">Select an active workspace.</div>
              </Show>
            </div>
            <Show when={telegramStatus()}>
              {(value) => (
                <div class="rounded-xl border border-emerald-7/20 bg-emerald-1/20 px-4 py-3 text-xs text-emerald-11">
                  {value()}
                </div>
              )}
            </Show>
            <Show when={telegramError()}>
              {(value) => (
                <div class="rounded-xl border border-red-7/20 bg-red-1/30 px-4 py-3 text-xs text-red-12">
                  {value()}
                </div>
              )}
            </Show>
          </div>

          <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm space-y-4">
            <div class="flex items-center gap-2">
              <PlugZap size={18} class="text-gray-10" />
              <div>
                <div class="text-sm font-semibold text-gray-12">Slack</div>
                <div class="text-xs text-gray-9">Save bot + app tokens on the host (REST).</div>
              </div>
            </div>
            <input
              type="password"
              value={slackBotToken()}
              onInput={(e) => setSlackBotToken(e.currentTarget.value)}
              placeholder="Slack bot token (xoxb-...)"
              class="w-full rounded-xl border border-gray-5 bg-gray-1 px-3 py-2 text-sm text-gray-12 placeholder:text-gray-8 focus:outline-none focus:ring-2 focus:ring-gray-6"
            />
            <input
              type="password"
              value={slackAppToken()}
              onInput={(e) => setSlackAppToken(e.currentTarget.value)}
              placeholder="Slack app token (xapp-...)"
              class="w-full rounded-xl border border-gray-5 bg-gray-1 px-3 py-2 text-sm text-gray-12 placeholder:text-gray-8 focus:outline-none focus:ring-2 focus:ring-gray-6"
            />
            <Button
              variant="primary"
              class="h-9 px-4 text-xs"
              onClick={saveSlackTokens}
              disabled={slackSaving() || !slackBotToken().trim() || !slackAppToken().trim() || !workspaceId()}
            >
              {slackSaving() ? "Saving..." : "Save"}
            </Button>
            <Show when={slackStatus()}>
              {(value) => (
                <div class="rounded-xl border border-emerald-7/20 bg-emerald-1/20 px-4 py-3 text-xs text-emerald-11">
                  {value()}
                </div>
              )}
            </Show>
            <Show when={slackError()}>
              {(value) => (
                <div class="rounded-xl border border-red-7/20 bg-red-1/30 px-4 py-3 text-xs text-red-12">
                  {value()}
                </div>
              )}
            </Show>
          </div>
        </div>

        <div class="rounded-2xl border border-gray-4 bg-gray-1 p-5 shadow-sm space-y-4">
          <div class="flex items-center gap-2">
            <Smartphone size={18} class="text-gray-10" />
            <div>
              <div class="text-sm font-semibold text-gray-12">WhatsApp</div>
              <div class="text-xs text-gray-9">Pairing QR is owner-only.</div>
            </div>
          </div>

          <Show when={whatsAppEnabledError()}>
            {(value) => (
              <div class="rounded-xl border border-amber-7/20 bg-amber-1/30 px-4 py-3 text-xs text-amber-12">
                {value()}
              </div>
            )}
          </Show>

          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-gray-10">Enabled:</span>
            <span class="text-xs font-semibold text-gray-12">
              {whatsAppEnabled() === null ? "Unknown" : whatsAppEnabled() ? "Yes" : "No"}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              class="h-9 px-4 text-xs"
              onClick={fetchWhatsAppQr}
              disabled={whatsAppQrBusy()}
            >
              {whatsAppQrBusy() ? "Fetching QR..." : "Show QR (ASCII)"}
            </Button>
            <Button
              variant="outline"
              class="h-9 px-4 text-xs"
              onClick={() => {
                setWhatsAppQr(null);
                setWhatsAppQrError(null);
              }}
              disabled={!whatsAppQr() && !whatsAppQrError()}
            >
              Hide
            </Button>
          </div>

          <Show when={whatsAppQrError()}>
            {(value) => (
              <div class="rounded-xl border border-red-7/20 bg-red-1/30 px-4 py-3 text-xs text-red-12">
                {value()}
              </div>
            )}
          </Show>

          <Show when={whatsAppQr()}>
            {(value) => (
              <pre class="rounded-xl border border-gray-4 bg-gray-1 p-4 text-[11px] leading-snug text-gray-12 overflow-auto">
                {value()}
              </pre>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
