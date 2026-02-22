"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type AuthMode = "sign-in" | "sign-up";

type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

type WorkerLaunch = {
  workerId: string;
  workerName: string;
  status: string;
  provider: string | null;
  instanceUrl: string | null;
  clientToken: string | null;
  hostToken: string | null;
};

type WorkerSummary = {
  workerId: string;
  workerName: string;
  status: string;
};

type WorkerTokens = {
  clientToken: string | null;
  hostToken: string | null;
};

type LaunchEventLevel = "info" | "success" | "warning" | "error";

type LaunchEvent = {
  id: string;
  level: LaunchEventLevel;
  label: string;
  detail: string;
  at: string;
};

const LAST_WORKER_STORAGE_KEY = "openwork:web:last-worker";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim().length > 0) {
    const trimmed = payload.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("<!doctype") || lower.startsWith("<html") || lower.includes("<body")) {
      return `${fallback} Upstream returned an HTML error page.`;
    }
    if (trimmed.length > 240) {
      return `${fallback} Upstream returned a non-JSON error payload.`;
    }
    return trimmed;
  }
  if (!isRecord(payload)) {
    return fallback;
  }

  const message = payload.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }

  const error = payload.error;
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

function getUser(payload: unknown): AuthUser | null {
  if (!isRecord(payload) || !isRecord(payload.user)) {
    return null;
  }

  const user = payload.user;
  const id = user.id;
  const email = user.email;

  if (typeof id !== "string" || typeof email !== "string") {
    return null;
  }

  const name = typeof user.name === "string" ? user.name : null;
  return { id, email, name };
}

function getToken(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  return typeof payload.token === "string" ? payload.token : null;
}

function getWorker(payload: unknown): WorkerLaunch | null {
  if (!isRecord(payload) || !isRecord(payload.worker)) {
    return null;
  }

  const worker = payload.worker;
  const workerId = worker.id;
  const workerName = worker.name;
  const status = worker.status;

  if (typeof workerId !== "string" || typeof workerName !== "string") {
    return null;
  }

  const parsedStatus = typeof status === "string" ? status : "unknown";
  const instance = isRecord(payload.instance) ? payload.instance : null;
  const tokens = isRecord(payload.tokens) ? payload.tokens : null;

  return {
    workerId,
    workerName,
    status: parsedStatus,
    provider: instance && typeof instance.provider === "string" ? instance.provider : null,
    instanceUrl: instance && typeof instance.url === "string" ? instance.url : null,
    clientToken: tokens && typeof tokens.client === "string" ? tokens.client : null,
    hostToken: tokens && typeof tokens.host === "string" ? tokens.host : null
  };
}

function getWorkerSummary(payload: unknown): WorkerSummary | null {
  if (!isRecord(payload) || !isRecord(payload.worker)) {
    return null;
  }

  const worker = payload.worker;
  const workerId = worker.id;
  const workerName = worker.name;
  const status = worker.status;

  if (typeof workerId !== "string" || typeof workerName !== "string") {
    return null;
  }

  return {
    workerId,
    workerName,
    status: typeof status === "string" ? status : "unknown"
  };
}

function getWorkerTokens(payload: unknown): WorkerTokens | null {
  if (!isRecord(payload) || !isRecord(payload.tokens)) {
    return null;
  }

  const tokens = payload.tokens;
  const clientToken = typeof tokens.client === "string" ? tokens.client : null;
  const hostToken = typeof tokens.host === "string" ? tokens.host : null;

  if (!clientToken && !hostToken) {
    return null;
  }

  return { clientToken, hostToken };
}

function isWorkerLaunch(value: unknown): value is WorkerLaunch {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.workerId === "string" &&
    typeof value.workerName === "string" &&
    typeof value.status === "string" &&
    (typeof value.provider === "string" || value.provider === null) &&
    (typeof value.instanceUrl === "string" || value.instanceUrl === null) &&
    (typeof value.clientToken === "string" || value.clientToken === null) &&
    (typeof value.hostToken === "string" || value.hostToken === null)
  );
}

function getCheckoutUrl(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.polar)) {
    return null;
  }
  const checkoutUrl = payload.polar.checkoutUrl;
  return typeof checkoutUrl === "string" ? checkoutUrl : null;
}

function shortValue(value: string): string {
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

async function requestJson(path: string, init: RequestInit = {}, timeoutMs = 30000) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const shouldAttachTimeout = !init.signal && timeoutMs > 0;
  const timeoutController = shouldAttachTimeout ? new AbortController() : null;
  const timeoutHandle = timeoutController
    ? setTimeout(() => {
        timeoutController.abort();
      }, timeoutMs)
    : null;

  let response: Response;
  try {
    response = await fetch(`/api/den${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: init.signal ?? timeoutController?.signal
    });
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return { response, payload, text };
}

function StepPill({ index, done, active }: { index: number; done: boolean; active: boolean }) {
  const tone = done
    ? "border-[#4eb18f] bg-[#ebfff6] text-[#196448]"
    : active
      ? "border-[#dea15a] bg-[#fff6ea] text-[#7f4a12]"
      : "border-[#d5c8ba] bg-[#fffdf9] text-[#7f748d]";

  return (
    <span
      className={`mono inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${tone}`}
    >
      {done ? "✓" : index}
    </span>
  );
}

function FieldWithCopy({
  label,
  value,
  placeholder = "Not available yet."
}: {
  label: string;
  value: string | null;
  placeholder?: string;
}) {
  const displayValue = value ?? placeholder;

  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#62546f]">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={displayValue}
          className="input-field mono text-xs !py-1.5"
          onClick={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs"
          disabled={!value}
          onClick={() => {
            if (!value) {
              return;
            }
            void navigator.clipboard.writeText(value);
          }}
        >
          {value ? "Copy" : "N/A"}
        </button>
      </div>
    </label>
  );
}

export function CloudControlPanel() {
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [name, setName] = useState("OpenWork Builder");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("Log in to unlock cloud worker launch.");
  const [authError, setAuthError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  const [workerName, setWorkerName] = useState("Founder Ops Pilot");
  const [launchBusy, setLaunchBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [launchAttempted, setLaunchAttempted] = useState(false);
  const [paymentRequired, setPaymentRequired] = useState(false);
  const [paymentReturned, setPaymentReturned] = useState(false);
  const [launchMessage, setLaunchMessage] = useState("Sign in, then click Launch Cloud Worker.");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [worker, setWorker] = useState<WorkerLaunch | null>(null);
  const [workerLookupId, setWorkerLookupId] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [launchEvents, setLaunchEvents] = useState<LaunchEvent[]>([]);

  function appendLaunchEvent(level: LaunchEventLevel, label: string, detail: string) {
    setLaunchEvents((previous) => {
      const next: LaunchEvent[] = [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          level,
          label,
          detail,
          at: new Date().toISOString()
        },
        ...previous
      ];
      return next.slice(0, 12);
    });
  }

  async function refreshSession(token?: string | null, quiet = false) {
    const headers = new Headers();
    const bearer = token ?? authToken;
    if (bearer) {
      headers.set("Authorization", `Bearer ${bearer}`);
    }

    const { response, payload } = await requestJson("/v1/me", { method: "GET", headers });

    if (!response.ok) {
      setUser(null);
      if (!quiet) {
        setAuthError("No active session found. Sign in first.");
      }
      return false;
    }

    const sessionUser = getUser(payload);
    if (!sessionUser) {
      if (!quiet) {
        setAuthError("Session response was missing user details.");
      }
      return false;
    }

    setUser(sessionUser);
    if (!quiet) {
      setAuthMessage(`Session active for ${sessionUser.email}.`);
    }
    return true;
  }

  useEffect(() => {
    void refreshSession(undefined, true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const customerSessionToken = params.get("customer_session_token");
    if (!customerSessionToken) {
      return;
    }

    setPaymentReturned(true);
    setLaunchMessage("Payment return detected. Click Launch Cloud Worker to continue provisioning.");
    appendLaunchEvent("success", "Returned from Polar checkout.", `Session ${shortValue(customerSessionToken)}`);

    params.delete("customer_session_token");
    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(LAST_WORKER_STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as unknown;
      if (!isWorkerLaunch(parsed)) {
        return;
      }
      const restoredWorker: WorkerLaunch = {
        ...parsed,
        clientToken: null,
        hostToken: null
      };

      setWorker(restoredWorker);
      setWorkerLookupId(restoredWorker.workerId);
      setLaunchMessage(
        `Recovered previous worker ${restoredWorker.workerName}. Generate a new API key if you need one.`
      );
      appendLaunchEvent("info", "Recovered worker context from this browser.", `Worker ID ${parsed.workerId}`);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !worker) {
      return;
    }
    const storedWorker: WorkerLaunch = {
      ...worker,
      clientToken: null,
      hostToken: null
    };
    window.localStorage.setItem(LAST_WORKER_STORAGE_KEY, JSON.stringify(storedWorker));
  }, [worker]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);

    try {
      const route = authMode === "sign-up" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email";
      const payload =
        authMode === "sign-up"
          ? {
              name: name.trim() || "OpenWork Builder",
              email: email.trim(),
              password
            }
          : {
              email: email.trim(),
              password
            };

      const { response, payload: responsePayload } = await requestJson(route, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const message = getErrorMessage(responsePayload, `Request failed with ${response.status}.`);
        setAuthError(message);
        return;
      }

      const nextToken = getToken(responsePayload);
      if (nextToken) {
        setAuthToken(nextToken);
      }

      const parsedUser = getUser(responsePayload);
      if (parsedUser) {
        setUser(parsedUser);
        setAuthMessage(`Logged in as ${parsedUser.email}.`);
      } else {
        setAuthMessage("Authentication succeeded. Refreshing session...");
      }

      const sessionHealthy = await refreshSession(nextToken ?? undefined, true);
      if (!sessionHealthy && !parsedUser) {
        setAuthMessage("Authentication succeeded but session details are pending. Try Refresh session.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      setAuthError(message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleRefreshSession() {
    setAuthBusy(true);
    setAuthError(null);

    try {
      const healthy = await refreshSession();
      if (!healthy) {
        setAuthError("No active session found. Sign in first.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      setAuthError(message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLaunchWorker() {
    if (!user) {
      setLaunchError("Log in before launching a cloud worker.");
      return;
    }

    setLaunchBusy(true);
    setLaunchAttempted(true);
    setLaunchError(null);
    setCheckoutUrl(null);
    setLaunchMessage("Submitting launch request to OpenWork Cloud...");
    appendLaunchEvent("info", "Launch request started.", `Worker name: ${workerName.trim() || "Cloud Pilot"}`);

    try {
      const { response, payload } = await requestJson("/v1/workers", {
        method: "POST",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: JSON.stringify({
          name: workerName.trim() || "Cloud Pilot",
          destination: "cloud"
        })
      }, 30000);

      if (response.status === 402) {
        const checkout = getCheckoutUrl(payload);
        setPaymentRequired(true);
        setCheckoutUrl(checkout);
        setLaunchMessage("Payment required. Complete checkout and return to this card, then click Launch again.");
        appendLaunchEvent(
          "warning",
          "Launch blocked by paywall.",
          checkout ? "Checkout URL generated." : "Checkout URL missing."
        );
        if (!checkout) {
          setLaunchError("Paywall returned without a checkout URL.");
        }
        return;
      }

      if (!response.ok) {
        const message = getErrorMessage(payload, `Worker request failed with ${response.status}.`);
        setLaunchError(message);
        appendLaunchEvent("error", "Launch request failed.", message);
        return;
      }

      const parsedWorker = getWorker(payload);
      if (!parsedWorker) {
        setLaunchError("Worker launched but response format was unexpected.");
        appendLaunchEvent("error", "Launch response parsing failed.", "Worker payload format was unexpected.");
        return;
      }

      setPaymentRequired(false);
      setPaymentReturned(false);
      setWorker(parsedWorker);
      setWorkerLookupId(parsedWorker.workerId);
      setLaunchMessage("Worker launch completed. Copy the OpenWork address and worker API key below.");
      appendLaunchEvent("success", "Worker launch completed.", `Worker ID ${parsedWorker.workerId}`);
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "Launch request timed out after 30s. You can retry launch or come back later and check status with a Worker ID."
          : error instanceof Error
            ? error.message
            : "Unknown network error";
      setLaunchError(message);
      appendLaunchEvent("error", "Launch request failed.", message);
    } finally {
      setLaunchBusy(false);
    }
  }

  async function handleCheckWorkerStatus() {
    const id = workerLookupId.trim();
    if (!id) {
      setLaunchError("Enter a worker ID first.");
      return;
    }

    setStatusBusy(true);
    setLaunchError(null);

    try {
      const { response, payload } = await requestJson(`/v1/workers/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
      });

      if (!response.ok) {
        const message = getErrorMessage(payload, `Status check failed with ${response.status}.`);
        setLaunchError(message);
        appendLaunchEvent("error", "Status check failed.", message);
        return;
      }

      const summary = getWorkerSummary(payload);
      if (!summary) {
        setLaunchError("Status response was missing worker details.");
        appendLaunchEvent("error", "Status check parsing failed.", "Worker summary was missing.");
        return;
      }

      setWorker((previous) => {
        if (previous && previous.workerId === summary.workerId) {
          return {
            ...previous,
            workerName: summary.workerName,
            status: summary.status
          };
        }

        return {
          workerId: summary.workerId,
          workerName: summary.workerName,
          status: summary.status,
          provider: null,
          instanceUrl: null,
          clientToken: null,
          hostToken: null
        };
      });

      setLaunchMessage(`Worker ${summary.workerName} is currently ${summary.status}.`);
      appendLaunchEvent("info", "Worker status refreshed.", `${summary.workerName}: ${summary.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      setLaunchError(message);
      appendLaunchEvent("error", "Status check failed.", message);
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleGenerateWorkerKey() {
    const id = workerLookupId.trim();
    if (!id) {
      setLaunchError("Enter a worker ID before generating keys.");
      return;
    }

    setStatusBusy(true);
    setLaunchError(null);

    try {
      const { response, payload } = await requestJson(`/v1/workers/${encodeURIComponent(id)}/tokens`, {
        method: "POST",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const message = getErrorMessage(payload, `Token generation failed with ${response.status}.`);
        setLaunchError(message);
        appendLaunchEvent("error", "Worker key generation failed.", message);
        return;
      }

      const tokens = getWorkerTokens(payload);
      if (!tokens) {
        setLaunchError("Token generation succeeded but no keys were returned.");
        appendLaunchEvent("error", "Worker key generation failed.", "No token payload was returned.");
        return;
      }

      setWorker((previous) => {
        if (previous && previous.workerId === id) {
          return {
            ...previous,
            clientToken: tokens.clientToken,
            hostToken: tokens.hostToken
          };
        }

        return {
          workerId: id,
          workerName: "Existing worker",
          status: "unknown",
          provider: null,
          instanceUrl: null,
          clientToken: tokens.clientToken,
          hostToken: tokens.hostToken
        };
      });

      setLaunchMessage("Generated a fresh worker API key.");
      appendLaunchEvent("success", "Generated new worker keys.", `Worker ID ${id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      setLaunchError(message);
      appendLaunchEvent("error", "Worker key generation failed.", message);
    } finally {
      setStatusBusy(false);
    }
  }

  const launchSteps = useMemo(() => {
    const signedIn = Boolean(user);
    const launchDone = launchAttempted && !launchBusy;
    const paywallDone = paymentReturned || (launchAttempted && !paymentRequired && !launchBusy);
    const workerReady = Boolean(worker);

    return [
      {
        title: "Sign in",
        detail: signedIn ? `Signed in as ${user?.email}.` : "Use email + password to unlock launch.",
        done: signedIn,
        active: !signedIn
      },
      {
        title: "Launch requested",
        detail: launchBusy
          ? "Launch request is in flight."
          : launchAttempted
            ? "Launch request sent to OpenWork Cloud."
            : "Click Launch Cloud Worker to start.",
        done: launchDone,
        active: launchBusy
      },
      {
        title: "Paywall",
        detail: paymentRequired
          ? paymentReturned
            ? "Payment return detected. Launch again to finish."
            : "Complete Polar checkout and return here."
          : launchBusy
            ? "Waiting for launch response to confirm whether checkout is needed."
          : launchAttempted
            ? "No paywall block on the latest request."
            : "Only appears when plan access is required.",
        done: paywallDone,
        active: paymentRequired && !paymentReturned
      },
      {
        title: "Worker ready",
        detail: worker
          ? `Worker ${worker.workerName} is ${worker.status}.`
          : "When ready, this card will show URL + API key.",
        done: workerReady,
        active: statusBusy
      }
    ];
  }, [launchAttempted, launchBusy, paymentRequired, paymentReturned, statusBusy, user, worker]);

  return (
    <section className="surface fade-up p-5 sm:p-7">
      <div className="grid gap-5 lg:grid-cols-[1fr,1.06fr]">
        <div className="feature-card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">1) Log in</h2>
            <span className="chip text-[11px]">Standard auth</span>
          </div>

          <p className="mb-4 text-sm leading-relaxed text-[#544a64]">
            Log in first. This unlocks worker launch and lets this page hold your launch state.
          </p>

          <form className="space-y-3" onSubmit={handleAuthSubmit}>
            {authMode === "sign-up" ? (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[#62546f]">
                  Name
                </span>
                <input
                  className="input-field"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[#62546f]">
                Email
              </span>
              <input
                className="input-field"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[#62546f]">
                Password
              </span>
              <input
                className="input-field"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={authMode === "sign-up" ? "new-password" : "current-password"}
                required
              />
            </label>

            <button type="submit" className="btn-primary w-full" disabled={authBusy}>
              {authBusy ? "Working..." : authMode === "sign-in" ? "Log in" : "Create account"}
            </button>
          </form>

          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[#5f4f71]">
            <span>{authMode === "sign-in" ? "Need an account?" : "Already have an account?"}</span>
            <button
              type="button"
              className="font-semibold text-[#7a2f08] underline-offset-2 hover:underline"
              onClick={() => setAuthMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"))}
            >
              {authMode === "sign-in" ? "Create account" : "Switch to login"}
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-[#e8dccd] bg-[#fffdf9] p-3">
            <p className="text-sm text-[#3a3046]">{authMessage}</p>
            {user ? (
              <p className="mono mt-2 text-xs text-[#5f4f71]">
                {user.email} ({shortValue(user.id)})
              </p>
            ) : null}
            {authToken ? (
              <div className="mt-3">
                <FieldWithCopy label="Session API key" value={authToken} />
              </div>
            ) : null}
            {authError ? <p className="mt-2 text-sm text-[#b64018]">{authError}</p> : null}
          </div>

          <button
            type="button"
            className="btn-secondary mt-3 w-full"
            disabled={authBusy}
            onClick={handleRefreshSession}
          >
            Refresh session
          </button>
        </div>

        <div className="feature-card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">2) Launch Cloud Worker</h2>
            <span className="chip text-[11px]">Paywall aware</span>
          </div>

          <p className="mb-4 text-sm leading-relaxed text-[#544a64]">
            If paywall is required, finish payment and return here. Then click Launch Cloud Worker again.
          </p>

          <div className="mb-4 space-y-2 rounded-xl border border-[#e8dccd] bg-[#fffdf9] p-3">
            {launchSteps.map((step, index) => (
              <div key={step.title} className="flex items-start gap-3">
                <StepPill index={index + 1} done={step.done} active={step.active} />
                <div>
                  <p className="text-sm font-semibold text-[#3b3148]">{step.title}</p>
                  <p className="text-xs text-[#5f4f71]">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[#62546f]">
              Worker name
            </span>
            <input
              className="input-field"
              value={workerName}
              onChange={(event) => setWorkerName(event.target.value)}
              maxLength={80}
            />
          </label>

          <button
            type="button"
            className="btn-primary w-full"
            disabled={launchBusy || !user}
            onClick={handleLaunchWorker}
          >
            {launchBusy ? "Launching..." : "Launch Cloud Worker"}
          </button>

          {!user ? <p className="mt-2 text-xs text-[#6a5d78]">Log in to enable launch.</p> : null}

          {checkoutUrl ? (
            <div className="mt-4 rounded-xl border border-[#d5d6ef] bg-[#f5f7ff] p-3">
              <p className="mb-2 text-sm font-semibold text-[#3b3677]">Payment required</p>
              <a href={checkoutUrl} rel="noreferrer" className="btn-secondary inline-flex w-full justify-center">
                Continue to Polar checkout
              </a>
              <p className="mt-2 text-xs text-[#54508a]">
                After checkout, you should return to this app, then click Launch Cloud Worker again.
              </p>
            </div>
          ) : null}

          <div className="mt-4 rounded-xl border border-[#e8dccd] bg-[#fffdf9] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#3a3046]">Launch status</p>
              <p className="mono text-[11px] text-[#5f4f71]">
                {launchBusy ? "launching" : worker ? worker.status : "idle"}
              </p>
            </div>
            <p className="text-sm text-[#3a3046]">{launchMessage}</p>
            {launchError ? <p className="mt-2 text-sm text-[#b64018]">{launchError}</p> : null}

            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr,auto,auto]">
              <input
                className="input-field mono text-xs"
                placeholder="Worker ID for status checks"
                value={workerLookupId}
                onChange={(event) => setWorkerLookupId(event.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCheckWorkerStatus}
                disabled={statusBusy}
              >
                {statusBusy ? "Checking..." : "Check status"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleGenerateWorkerKey}
                disabled={statusBusy}
              >
                New API key
              </button>
            </div>

            <p className="mt-2 text-xs text-[#5f4f71]">
              You can come back later with the worker ID and use Check status or New API key.
            </p>
          </div>

          {worker ? (
            <div className="mt-4 space-y-3 rounded-xl border border-[#d7d9eb] bg-[#f8fbff] p-3">
              <p className="text-sm font-semibold text-[#2d3468]">Worker connection details</p>
              <FieldWithCopy label="Worker ID" value={worker.workerId} />
              <FieldWithCopy label="OpenWork address" value={worker.instanceUrl} placeholder="URL will appear after provisioning." />
              <FieldWithCopy label="Worker API key" value={worker.clientToken} placeholder="Generate a key using New API key." />

              {worker.hostToken ? (
                <details className="rounded-lg border border-[#d1d7eb] bg-white px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-[#44518a]">Advanced: host key</summary>
                  <div className="mt-2">
                    <FieldWithCopy label="Host key" value={worker.hostToken} />
                  </div>
                </details>
              ) : null}

              <div className="rounded-lg border border-[#d1d7eb] bg-white px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#44518a]">Connect in OpenWork app</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-[#374372]">
                  <li>Open the OpenWork app.</li>
                  <li>Go to remote/cloud worker connect.</li>
                  <li>Paste the OpenWork address and Worker API key from this card.</li>
                </ol>
              </div>
            </div>
          ) : null}

          {launchEvents.length > 0 ? (
            <div className="mt-4 rounded-xl border border-[#e8dccd] bg-[#fffdf9] p-3">
              <p className="mb-2 text-sm font-semibold text-[#3a3046]">Launch log</p>
              <ul className="space-y-2">
                {launchEvents.map((entry) => {
                  const accent =
                    entry.level === "success"
                      ? "text-[#1e7a5b]"
                      : entry.level === "warning"
                        ? "text-[#8a4f14]"
                        : entry.level === "error"
                          ? "text-[#b64018]"
                          : "text-[#5f4f71]";

                  return (
                    <li key={entry.id} className="rounded-lg border border-[#ede3d7] bg-white px-2 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-xs font-semibold ${accent}`}>{entry.label}</p>
                        <span className="mono text-[10px] text-[#80748f]">
                          {new Date(entry.at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#5a4f69]">{entry.detail}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
