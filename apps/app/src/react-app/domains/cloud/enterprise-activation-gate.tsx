/** @jsxImportSource react */
import { Dithering } from "@paper-design/shaders-react";
import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import {
  buildDenAuthUrl,
  createDenClient,
  readDenBootstrapConfig,
  setDenBootstrapConfig,
} from "@/app/lib/den";
import { exchangeHandoffAndSignIn } from "@/app/lib/den-handoff";
import { denSettingsChangedEvent } from "@/app/lib/den-session-events";
import { markDesktopSignInInitiated } from "@/app/lib/den-sign-in-intent";
import { enterpriseActivationRequired } from "@/app/lib/enterprise-activation";
import { readDesktopDistributionInfo } from "@/app/lib/desktop";
import { parseManualAuthInput } from "@/app/lib/manual-auth-input";
import { normalizeOrganizationServerInput } from "@/app/lib/organization-server-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveExtensionIconSrc } from "@/react-app/design-system/extension-icon-src";
import { tryOpenBrowserAuthUrl } from "./open-browser-auth";

function subscribeToBootstrap(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(denSettingsChangedEvent, onStoreChange);
  return () => window.removeEventListener(denSettingsChangedEvent, onStoreChange);
}

export function useEnterpriseActivationRequired() {
  const bootstrap = useSyncExternalStore(
    subscribeToBootstrap,
    readDenBootstrapConfig,
    readDenBootstrapConfig,
  );
  return enterpriseActivationRequired(readDesktopDistributionInfo(), bootstrap);
}

function EnterpriseActivationPage() {
  const [serverInput, setServerInput] = useState("");
  const [serverBaseUrl, setServerBaseUrl] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [manualAuthOpen, setManualAuthOpen] = useState(false);
  const [manualAuthInput, setManualAuthInput] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const submitServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const baseUrl = normalizeOrganizationServerInput(serverInput);
    if (!baseUrl) {
      setServerError("Enter a valid OpenWork server address.");
      return;
    }

    setBrowserBusy(true);
    setServerError(null);
    setAuthError(null);
    try {
      await setDenBootstrapConfig({ baseUrl, requireSignin: true });
      setServerInput(baseUrl);
      setServerBaseUrl(baseUrl);
      markDesktopSignInInitiated();
      const opened = await tryOpenBrowserAuthUrl(buildDenAuthUrl(baseUrl, "sign-in"));
      if (!opened) {
        setStatusMessage(null);
        setAuthError("We couldn't open your browser automatically. Paste your sign-in code below.");
        setManualAuthOpen(true);
        return;
      }
      setStatusMessage("Finish signing in in your browser, then return to OpenWork.");
    } catch (error) {
      setStatusMessage(null);
      setServerError(
        error instanceof Error ? error.message : "Unable to save this OpenWork server.",
      );
    } finally {
      setBrowserBusy(false);
    }
  };

  const submitManualAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseManualAuthInput(manualAuthInput);
    if (!parsed) {
      setAuthError("Paste a valid OpenWork sign-in link or one-time sign-in code.");
      return;
    }

    const linkBaseUrl = parsed.baseUrl
      ? normalizeOrganizationServerInput(parsed.baseUrl)
      : null;
    const enteredBaseUrl = normalizeOrganizationServerInput(serverInput) ?? serverBaseUrl;
    const baseUrl = linkBaseUrl ?? enteredBaseUrl;
    if (!baseUrl) {
      setServerError("Enter your organization's OpenWork server before using a raw sign-in code.");
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    setServerError(null);
    setStatusMessage("Finishing OpenWork Enterprise sign-in…");
    try {
      const result = await exchangeHandoffAndSignIn(parsed.grant, {
        baseUrl,
        client: createDenClient({ baseUrl }),
        desktopInitiated: true,
        fallbackErrorMessage: "OpenWork Enterprise did not return a session token.",
      });
      if (!result.ok) {
        setStatusMessage(null);
        setAuthError(result.error);
        return;
      }

      await setDenBootstrapConfig({
        baseUrl,
        requireSignin: true,
        enterpriseActivation: {
          activatedAt: new Date().toISOString(),
          denBaseUrl: baseUrl,
        },
      });
    } catch (error) {
      setStatusMessage(null);
      setAuthError(
        error instanceof Error ? error.message : "Unable to finish OpenWork Enterprise sign-in.",
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const liveMessage = serverError ?? authError ?? statusMessage;

  return (
    <div
      className="relative min-h-dvh bg-background text-foreground"
      data-state="enterprise-activation"
      data-testid="enterprise-activation-root"
    >
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-[0.1] dark:invert"
        data-testid="enterprise-activation-background"
      >
        <Dithering
          className="size-full"
          speed={0.01}
          shape="warp"
          type="2x2"
          size={20.3}
          scale={1.19}
          frame={264559.21}
          colorBack="#00000000"
          colorFront="#000000"
        />
      </div>

      <div className="absolute inset-x-0 top-0 z-20 h-10 mac:titlebar-drag" />

      <div
        className="relative z-10 flex min-h-dvh items-center justify-center px-6 py-16"
        data-testid="enterprise-activation-foreground"
      >
        <section
          className="w-full max-w-[720px] rounded-3xl border border-border bg-background px-8 pb-12 pt-10 sm:px-16 sm:pb-16 sm:pt-14"
          data-testid="enterprise-activation-card"
        >
          <div className="flex items-center gap-2.5">
            <img
              src={resolveExtensionIconSrc("/openwork-mark.svg")}
              alt=""
              width={26}
              height={26}
              className="max-h-[26px] shrink-0 object-contain object-left dark:invert"
              aria-hidden="true"
            />
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              OpenWork Enterprise
            </span>
          </div>

          <div className="mt-10 flex flex-col gap-2.5 sm:mt-14">
            <h1 className="text-[30px] font-semibold leading-[38px] tracking-[-0.03em] text-foreground sm:text-[38px] sm:leading-[46px]">
              Sign in to OpenWork Enterprise
            </h1>
            <p className="text-[15px] leading-[23px] text-muted-foreground">
              On your organization&apos;s OpenWork page, choose <strong className="font-semibold text-foreground">Open OpenWork</strong>, or enter your organization&apos;s server below.
            </p>
          </div>

          <div className="mt-11 flex flex-col gap-4">
            <form className="space-y-2" onSubmit={(event) => void submitServer(event)}>
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="organization-server-input"
              >
                Organization server
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="organization-server-input"
                  data-testid="organization-server-input"
                  value={serverInput}
                  onChange={(event) => setServerInput(event.currentTarget.value)}
                  placeholder="openwork.acme.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={browserBusy || authBusy}
                  aria-invalid={serverError ? true : undefined}
                />
                <Button
                  type="submit"
                  className="sm:min-w-40"
                  disabled={browserBusy || authBusy}
                  data-testid="organization-server-continue"
                >
                  Continue in browser
                </Button>
              </div>
            </form>

            <div className="min-h-5 text-xs leading-5" aria-live="polite" role="status">
              {liveMessage ? (
                <span className={serverError || authError ? "text-destructive" : "text-muted-foreground"}>
                  {liveMessage}
                </span>
              ) : null}
            </div>

            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setManualAuthOpen((open) => !open);
                  setAuthError(null);
                }}
                disabled={browserBusy || authBusy}
              >
                {manualAuthOpen ? "Hide sign-in code" : "Paste sign-in code"}
              </Button>

              {manualAuthOpen ? (
                <form
                  className="space-y-3 rounded-xl border border-border bg-muted/30 p-4"
                  onSubmit={(event) => void submitManualAuth(event)}
                >
                  <label className="text-sm font-medium text-foreground" htmlFor="enterprise-signin-code">
                    Sign-in link or one-time code
                  </label>
                  <Input
                    id="enterprise-signin-code"
                    value={manualAuthInput}
                    onChange={(event) => setManualAuthInput(event.currentTarget.value)}
                    placeholder="openwork://den-auth?... or pasted code"
                    disabled={authBusy}
                  />
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={authBusy || !manualAuthInput.trim()}
                  >
                    {authBusy ? "Finishing…" : "Finish sign-in"}
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function EnterpriseActivationGate({ children }: { children: ReactNode }) {
  return useEnterpriseActivationRequired()
    ? <EnterpriseActivationPage />
    : children;
}
