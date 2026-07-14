/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { ConnectLinkClaims, ConnectLinkVerifyErrorCode } from "@openwork/types/connect-link";

import { refreshDenBootstrapConfigFromShell } from "../../../app/lib/den";
import { connectLinkAccept, connectLinkVerify } from "../../../app/lib/desktop";
import {
  deepLinkBridgeEvent,
  drainPendingDeepLinks,
  type DeepLinkBridgeDetail,
} from "../../../app/lib/deep-link-bridge";
import { parseConnectDeepLink } from "../../../app/lib/openwork-links";
import { isDesktopRuntime } from "../../../app/utils";
import { ConnectConfirmDialog, type ConnectConfirmPhase } from "./connect-confirm-dialog";

type ConnectLinkError = { code: ConnectLinkVerifyErrorCode; message: string };

type PendingConnectLink = {
  rawUrl: string;
  token: string;
  claims: ConnectLinkClaims;
};

type ConnectLinkProviderProps = {
  children: ReactNode;
};

/**
 * Global consumer for `openwork://connect?token=<JWT>` deep links in the
 * normal desktop app. Relays the raw URL to the Electron main process for verification
 * against the embedded vendor keys, walks the user through an explicit
 * confirmation, and only then lets the main process persist the new desktop
 * bootstrap config. Mirrors the den-auth-provider deep-link listener pattern.
 */
export function ConnectLinkProvider({ children }: ConnectLinkProviderProps) {
  const [phase, setPhase] = useState<ConnectConfirmPhase | "idle">("idle");
  const [pending, setPending] = useState<PendingConnectLink | null>(null);
  const [error, setError] = useState<ConnectLinkError | null>(null);
  const handledTokensRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<PendingConnectLink | null>(null);

  const beginVerify = useCallback((rawUrl: string, token: string) => {
    handledTokensRef.current.add(token);
    setError(null);
    setPending(null);
    pendingRef.current = null;
    setPhase("verifying");

    void connectLinkVerify(rawUrl).then((result) => {
      if (result.ok) {
        const next = { rawUrl, token, claims: result.claims };
        pendingRef.current = next;
        setPending(next);
        setPhase("confirm");
        return;
      }
      // Leave failed tokens handled — the same broken link should not
      // re-prompt every time the queue replays it.
      setError({ code: result.code, message: result.message });
      setPhase("error");
    }).catch(() => {
      setError({ code: "invalid_token", message: "Could not verify the connect link." });
      setPhase("error");
    });
  }, []);

  const handleUrls = useCallback((urls: readonly string[]) => {
    for (const rawUrl of urls) {
      const parsed = parseConnectDeepLink(rawUrl);
      if (!parsed || handledTokensRef.current.has(parsed.token)) continue;
      beginVerify(parsed.rawUrl, parsed.token);
      // One prompt at a time; later links can arrive again as new deep-link
      // events after the current prompt is resolved.
      break;
    }
  }, [beginVerify]);

  useEffect(() => {
    if (typeof window === "undefined" || !isDesktopRuntime()) return;

    handleUrls(drainPendingDeepLinks(window));
    const handleDeepLink = (event: Event) => {
      handleUrls(((event as CustomEvent<DeepLinkBridgeDetail>).detail?.urls ?? []) as string[]);
    };

    window.addEventListener(deepLinkBridgeEvent, handleDeepLink);
    return () => window.removeEventListener(deepLinkBridgeEvent, handleDeepLink);
  }, [handleUrls]);

  const dismiss = useCallback(() => {
    setPhase("idle");
    setPending(null);
    pendingRef.current = null;
    setError(null);
  }, []);

  const confirm = useCallback(() => {
    const current = pendingRef.current;
    if (!current) return;
    setPhase("applying");

    void connectLinkAccept(current.rawUrl).then(async (result) => {
      if (!result.ok) {
        setError({ code: result.code, message: result.message });
        setPhase("error");
        return;
      }
      // The shell already persisted desktop-bootstrap.json; converge the
      // renderer snapshot so DenSigninGate takes over (requireSignin flow).
      await refreshDenBootstrapConfigFromShell();
      dismiss();
    }).catch(() => {
      setError({ code: "invalid_token", message: "Could not apply the connect link." });
      setPhase("error");
    });
  }, [dismiss]);

  return (
    <>
      {children}
      <ConnectConfirmDialog
        open={phase !== "idle"}
        phase={phase === "idle" ? "verifying" : phase}
        claims={pending?.claims ?? null}
        currentHost={null}
        error={error}
        onConfirm={confirm}
        onDismiss={dismiss}
      />
    </>
  );
}
