/** @jsxImportSource react */
import { useCallback, useState } from "react";
import { CheckCircle2, Chrome, Loader2, MonitorSmartphone, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { openChromeRemoteDebugging } from "../../../app/lib/desktop";
import { surfaceCardClass } from "../workspace/modal-styles";
import { findReachableChromeDebuggingPort } from "./chrome-reachability";
import { registerExtensionConfig } from "./extension-registry";

type ChromeStatus = "unknown" | "checking" | "connected" | "unavailable";

registerExtensionConfig("openwork-browser", () => <OpenWorkBrowserConfig />);
registerExtensionConfig("chrome-browser", () => <ChromeBrowserConfig />);

function OpenWorkBrowserConfig() {
  return (
    <div className={`${surfaceCardClass} space-y-3 p-4`}>
      <div className="flex items-start gap-3">
        <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-blue-11" />
        <div className="space-y-1 text-[13px] leading-relaxed text-dls-secondary">
          <div className="font-medium text-dls-text">Ready by default</div>
          <div>The OpenWork Browser runs inside the app, opens visibly for browser tasks, and is the safest default when the user does not need personal Chrome cookies.</div>
        </div>
      </div>
    </div>
  );
}

function ChromeBrowserConfig() {
  const [status, setStatus] = useState<ChromeStatus>("unknown");
  const [port, setPort] = useState<number | null>(null);
  const [manualPort, setManualPort] = useState("");
  const testConnection = useCallback(async () => {
    setStatus("checking");
    const parsedPort = Number(manualPort.trim());
    const nextPort = await findReachableChromeDebuggingPort(Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : null);
    setPort(nextPort);
    setStatus(nextPort ? "connected" : "unavailable");
  }, [manualPort]);

  return (
    <div className={`${surfaceCardClass} space-y-4 p-4`}>
      <div className="flex items-start gap-3">
        <Chrome className="mt-0.5 size-4 shrink-0 text-amber-11" />
        <div className="space-y-1 text-[13px] leading-relaxed text-dls-secondary">
          <div className="font-medium text-dls-text">Use real Chrome for signed-in sites</div>
          <div>Enable remote debugging in Chrome, then test the connection. Use this extension only when a task needs your browser cookies, sign-ins, or installed extensions.</div>
        </div>
      </div>
      <button
        type="button"
        className="w-full rounded-xl border border-dls-border bg-dls-surface px-3 py-2 text-left text-xs text-dls-secondary transition-colors hover:bg-dls-hover"
        onClick={() => void openChromeRemoteDebugging()}
      >
        Open <span className="font-mono text-dls-text">chrome://inspect/#remote-debugging</span>, turn on remote debugging, and allow incoming connections.
      </button>
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-[0.15em] text-dls-secondary" htmlFor="chrome-debug-port">
          Debugging port
        </label>
        <input
          id="chrome-debug-port"
          inputMode="numeric"
          value={manualPort}
          onChange={(event) => setManualPort(event.currentTarget.value.replace(/[^0-9]/g, ""))}
          placeholder="Auto-detect, or enter 64945"
          className="w-full rounded-xl border border-dls-border bg-dls-surface px-3 py-2 text-sm text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.2)]"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={testConnection} disabled={status === "checking"}>
          {status === "checking" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Test Chrome
        </Button>
        {status === "connected" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-3 px-2.5 py-1 text-xs font-medium text-green-11">
            <CheckCircle2 className="size-3.5" /> Connected{port ? `:${port}` : ""}
          </span>
        ) : status === "unavailable" ? (
          <span className="rounded-full bg-amber-3 px-2.5 py-1 text-xs font-medium text-amber-11">Not reachable</span>
        ) : null}
      </div>
    </div>
  );
}
