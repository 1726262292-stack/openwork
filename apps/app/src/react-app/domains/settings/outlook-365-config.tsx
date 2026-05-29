/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail, ShieldCheck, UserRound, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OpenworkServerClient, Outlook365AuthStatus } from "../../../app/lib/openwork-server";
import { usePlatform } from "../../kernel/platform";
import type { ExtensionConfigContext } from "./extension-registry";
import { registerExtensionRuntime } from "./extension-registry";

type BusyAction = "status" | "connect" | "disconnect" | "test";
type Outlook365Command = () => Promise<unknown>;
const DESKTOP_ACTION_TIMEOUT_MS = 6 * 60 * 1000;
const CONNECT_POLL_INTERVAL_MS = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeOutlook365Account(value: unknown): Outlook365AuthStatus["account"] {
  if (!isRecord(value)) return null;
  return {
    id: typeof value.id === "string" ? value.id : null,
    displayName: typeof value.displayName === "string" ? value.displayName : null,
    mail: typeof value.mail === "string" ? value.mail : null,
    userPrincipalName: typeof value.userPrincipalName === "string" ? value.userPrincipalName : null,
  };
}

function normalizeOutlook365AuthStatus(value: unknown): Outlook365AuthStatus {
  const record = isRecord(value) ? value : {};
  const vault = record.vault === "encrypted" || record.vault === "plaintext-dev" ? record.vault : "unavailable";
  return {
    configured: record.configured === true,
    missing: normalizeStringList(record.missing),
    vault,
    connected: record.connected === true,
    account: normalizeOutlook365Account(record.account),
    scopes: normalizeStringList(record.scopes),
    connectedAt: typeof record.connectedAt === "string" ? record.connectedAt : null,
    error: typeof record.error === "string" ? record.error : null,
    testStatus: typeof record.testStatus === "string" ? record.testStatus : null,
    mock: record.mock === true,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForOutlook365Connection(client: OpenworkServerClient, flowId: string, expiresAt: number) {
  while (Date.now() < expiresAt + 5_000) {
    const result = await client.outlook365ConnectStatus(flowId);
    if (result.status === "connected" && result.outlook365) return result.outlook365;
    if (result.status === "failed" || result.status === "expired") {
      throw new Error(result.error ?? "Outlook 365 connection did not complete.");
    }
    await sleep(CONNECT_POLL_INTERVAL_MS);
  }
  throw new Error("Outlook 365 OAuth timed out.");
}

function accountLabel(status: Outlook365AuthStatus) {
  return status.account?.mail ?? status.account?.userPrincipalName ?? status.account?.displayName ?? null;
}

function Outlook365Config({ openworkServerClient, onExtensionConnectionChange }: ExtensionConfigContext) {
  const platform = usePlatform();
  const [status, setStatus] = useState<Outlook365AuthStatus | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const serverAvailable = Boolean(openworkServerClient);
  const canConnect = serverAvailable && status?.configured === true && status.vault !== "unavailable";
  const canTest = serverAvailable && status?.connected === true;

  const loadStatus = async (options: { clearError?: boolean } = {}) => {
    if (!openworkServerClient) return;
    setBusyAction("status");
    if (options.clearError !== false) setError(null);
    try {
      const result = normalizeOutlook365AuthStatus(await openworkServerClient.outlook365Status());
      setStatus(result);
      onExtensionConnectionChange?.("outlook-365", result.connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read Outlook 365 status.");
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [openworkServerClient]);

  const runDesktopAction = async (action: Exclude<BusyAction, "status">, command: Outlook365Command) => {
    if (!openworkServerClient) return;
    setBusyAction(action);
    setError(null);
    try {
      const result = await Promise.race([
        command(),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("Outlook 365 connection is taking too long. Try again, or restart OpenWork if the browser already said authorization was received.")), DESKTOP_ACTION_TIMEOUT_MS);
        }),
      ]);
      const next = normalizeOutlook365AuthStatus(result);
      setStatus(next);
      onExtensionConnectionChange?.("outlook-365", next.connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Outlook 365 ${action} failed.`);
      await loadStatus({ clearError: false });
    } finally {
      setBusyAction(null);
    }
  };

  const connectOutlook365 = async () => {
    if (!openworkServerClient) return null;
    const flow = await openworkServerClient.outlook365ConnectStart();
    if (!flow.authUrl.startsWith("mock://")) platform.openLink(flow.authUrl);
    return waitForOutlook365Connection(openworkServerClient, flow.flowId, flow.expiresAt);
  };

  return (
    <div className="space-y-4">
      {!serverAvailable ? (
        <Alert variant="warning">
          <ShieldCheck />
          <AlertTitle>OpenWork server required</AlertTitle>
          <AlertDescription>Start OpenWork server to connect Outlook 365.</AlertDescription>
        </Alert>
      ) : null}

      {status?.connected ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Connected to Outlook 365</AlertTitle>
          <AlertDescription>
            {accountLabel(status) ? `Signed in as ${accountLabel(status)}.` : "Your Microsoft account is connected."}
            {status.testStatus ? ` ${status.testStatus}` : ""}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <ShieldCheck />
          <AlertTitle>Connect Outlook 365</AlertTitle>
          <AlertDescription>
            Use the minimum Microsoft permission set so OpenWork can identify the connected Outlook account.
          </AlertDescription>
        </Alert>
      )}

      {status && !status.configured ? (
        <Alert variant="warning">
          <XCircle />
          <AlertTitle>Microsoft OAuth client not configured</AlertTitle>
          <AlertDescription>Set OPENWORK_OUTLOOK_365_OAUTH_CLIENT_ID to enable Outlook 365 sign-in.</AlertDescription>
        </Alert>
      ) : null}

      {error || status?.error ? (
        <Alert variant="destructive">
          <XCircle />
          <AlertTitle>Outlook 365 error</AlertTitle>
          <AlertDescription>{error ?? status?.error}</AlertDescription>
        </Alert>
      ) : null}

      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>What OpenWork can do</CardTitle>
          <CardDescription>
            This first Outlook 365 connection uses only Microsoft sign-in and profile access. Mailbox and calendar tools can be added later with separate permission review.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-3">
            <UserRound className="mb-2 size-4 text-blue-11" />
            <div className="text-sm font-medium text-card-foreground">Account identity</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">Verify the signed-in Microsoft account using User.Read.</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3">
            <Mail className="mb-2 size-4 text-indigo-11" />
            <div className="text-sm font-medium text-card-foreground">No mailbox access yet</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">This phase does not read mail, send mail, or create drafts.</div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outline" size="sm">
        <CardFooter className="flex-wrap gap-2 justify-between">
          <div className="flex flex-wrap gap-2">
            {status?.connected ? (
              <Button variant="destructive" disabled={Boolean(busyAction)} onClick={() => void runDesktopAction("disconnect", () => openworkServerClient?.outlook365Disconnect() ?? Promise.resolve(null))}>
                {busyAction === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : null}
                Disconnect
              </Button>
            ) : (
              <Button disabled={Boolean(busyAction) || !canConnect} onClick={() => void runDesktopAction("connect", connectOutlook365)}>
                {busyAction === "connect" ? <Loader2 className="size-4 animate-spin" /> : null}
                Connect with Microsoft
              </Button>
            )}
            <Button variant="outline" disabled={Boolean(busyAction) || !canTest} onClick={() => void runDesktopAction("test", () => openworkServerClient?.outlook365TestConnection() ?? Promise.resolve(null))}>
              {busyAction === "test" ? <Loader2 className="size-4 animate-spin" /> : null}
              Test connection
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

registerExtensionRuntime({
  id: "outlook-365",
  settingsPanel: (ctx) => <Outlook365Config {...ctx} />,
  settingsPanelRefs: ["openwork.outlook365.settings"],
  isConnected: (_entry, ctx) => Boolean(ctx.extensionConnections?.["outlook-365"]),
});
