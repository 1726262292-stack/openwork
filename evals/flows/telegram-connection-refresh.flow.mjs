/**
 * Telegram connection refresh-loop regression proof.
 *
 * Reuses the Cloud Connect mock and seeded worker used by
 * telegram-cloud-connect.flow.mjs. Start the mock and seed the deterministic
 * worker before running this flow against the Den stack.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { denApiFetch, openAdminConnections, signInApi, signInViaBrowser } from "./lib/den-web.mjs";

const FLOW_ID = "telegram-connection-refresh";
const vo = await loadVoiceoverParagraphs(FLOW_ID);
const execFileAsync = promisify(execFile);

const ADMIN_EMAIL = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
const MOCK_SERVER_URL = (process.env.OPENWORK_EVAL_CLOUD_CONNECT_MOCK_URL ?? "http://127.0.0.1:3979")
  .trim()
  .replace(/\/+$/, "");
const BOT_TOKEN = process.env.OPENWORK_EVAL_CLOUD_CONNECT_TELEGRAM_TOKEN?.trim() || "900100:OPENWORK_TEST_TOKEN";
const WORKER_NAME = process.env.OPENWORK_EVAL_CLOUD_CONNECT_WORKER_NAME?.trim() || "Cloud Connect Test Worker";
const BOT_USERNAME = "openwork_test_bot";
const PAIRING_UPDATE_ID = 93_001;

const state = {
  adminSession: null,
  orgId: null,
  orgName: null,
  browserSessionId: null,
  connectionId: null,
  webhookUrl: null,
  webhookSecret: null,
  pairingCode: null,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function witness(ctx, condition, assertion, actual) {
  ctx.assert(condition, `${assertion}. Actual: ${JSON.stringify(actual)}`);
  ctx.recordEvidence({ type: "assertion", status: "passed", assertion, actual });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sqlString(value) {
  return `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function daytonaSandbox(ctx) {
  return ctx.env.OPENWORK_EVAL_DAYTONA_SANDBOX?.trim() ?? "";
}

async function daytonaExec(ctx, label, script, timeout = 90_000) {
  const sandbox = daytonaSandbox(ctx);
  if (!sandbox) throw new Error("OPENWORK_EVAL_DAYTONA_SANDBOX is required for Daytona execution.");
  const encoded = Buffer.from(script, "utf8").toString("base64");
  try {
    const result = await execFileAsync(
      "daytona",
      ["exec", sandbox, "--", "echo", encoded, "|", "base64", "-d", "|", "bash"],
      { timeout, maxBuffer: 2 * 1024 * 1024 },
    );
    ctx.log(`Daytona ${label}: ${result.stdout.trim().slice(0, 500)}`);
    return result.stdout.trim();
  } catch (error) {
    const stdout = error && typeof error === "object" ? error.stdout : "";
    const stderr = error && typeof error === "object" ? error.stderr : "";
    throw new Error(`Daytona ${label} failed: ${errorMessage(error)} stdout=${String(stdout ?? "").slice(0, 500)} stderr=${String(stderr ?? "").slice(0, 500)}`);
  }
}

function mysqlContainer(ctx) {
  return ctx.env.OPENWORK_EVAL_DEN_MYSQL_CONTAINER?.trim() || "openwork-web-local-mysql";
}

async function verifyLocalMysqlContainer(ctx, container) {
  try {
    const result = await execFileAsync("docker", ["inspect", "-f", "{{.State.Running}}", container], { timeout: 10_000 });
    if (result.stdout.trim() !== "true") {
      throw new Error(`container state is ${result.stdout.trim() || "unknown"}`);
    }
  } catch (error) {
    const configured = Boolean(ctx.env.OPENWORK_EVAL_DEN_MYSQL_CONTAINER?.trim());
    const hint = configured
      ? `Configured local MySQL container ${JSON.stringify(container)} is not running.`
      : `Default local MySQL container ${JSON.stringify(container)} is not running; set OPENWORK_EVAL_DEN_MYSQL_CONTAINER or run pnpm evals --stack den.`;
    throw new Error(`${hint} ${errorMessage(error)}`);
  }
}

async function runDaytonaMysql(ctx, sql) {
  const encodedSql = Buffer.from(sql, "utf8").toString("base64");
  return daytonaExec(ctx, "mysql", `
set -euo pipefail
sql_file=$(mktemp)
trap 'rm -f "$sql_file"' EXIT
printf '%s' '${encodedSql}' | base64 -d > "$sql_file"
mysql -uroot -ppassword openwork_den < "$sql_file"
`);
}

async function runDockerMysql(ctx, sql) {
  const container = mysqlContainer(ctx);
  await verifyLocalMysqlContainer(ctx, container);
  const { stdout, stderr } = await execFileAsync("docker", [
    "exec",
    container,
    "mysql",
    "-uroot",
    "-ppassword",
    "openwork_den",
    "-e",
    sql,
  ]);
  if (stderr.trim()) ctx.log(`mysql stderr: ${stderr.trim()}`);
  return stdout;
}

async function runMysql(ctx, sql) {
  if (daytonaSandbox(ctx)) return runDaytonaMysql(ctx, sql);
  return runDockerMysql(ctx, sql);
}

async function mockState() {
  const response = await fetch(`${MOCK_SERVER_URL}/__mock/state`);
  if (!response.ok) throw new Error(`Mock state failed: ${response.status}`);
  return response.json();
}

async function resetMock(ctx) {
  const response = await fetch(`${MOCK_SERVER_URL}/__mock/reset`, { method: "POST" });
  witness(ctx, response.ok, "The Cloud Connect mock resets Telegram state and request logs.", { status: response.status });
}

function orgHeaders() {
  if (!state.adminSession) throw new Error("Missing admin session.");
  if (!state.orgId) throw new Error("Missing selected organization.");
  return { authorization: `Bearer ${state.adminSession}`, "x-openwork-org-id": state.orgId };
}

async function authenticatedApi(path, options = {}) {
  return denApiFetch(path, {
    ...options,
    headers: {
      ...orgHeaders(),
      ...(options.headers ?? {}),
    },
  });
}

async function selectAdminOrganization(ctx) {
  const listed = await denApiFetch("/v1/me/orgs", {
    headers: { authorization: `Bearer ${state.adminSession}` },
  });
  ctx.assert(listed.response.ok, `Admin org list failed: ${listed.response.status} ${JSON.stringify(listed.body).slice(0, 200)}`);
  const orgs = Array.isArray(listed.body.orgs) ? listed.body.orgs : [];
  const acme = orgs.find((org) => org.slug === "acme-robotics-demo");
  const adminOrg = orgs.find((org) => ["owner", "admin"].includes(String(org.role ?? "").toLowerCase()));
  const selected = acme ?? adminOrg;
  ctx.assert(
    selected && typeof selected.id === "string",
    `Admin ${ADMIN_EMAIL} has no owner/admin organization. Orgs: ${JSON.stringify(orgs)}`,
  );
  state.orgId = selected.id;
  state.orgName = typeof selected.name === "string" && selected.name ? selected.name : selected.slug ?? selected.id;

  const activated = await denApiFetch("/v1/me/active-organization", {
    method: "POST",
    headers: { authorization: `Bearer ${state.adminSession}` },
    body: JSON.stringify({ organizationId: state.orgId }),
  });
  witness(ctx, activated.response.ok, `The API session is pinned to ${state.orgName}.`, {
    status: activated.response.status,
    organizationId: state.orgId,
  });
}

async function setBrowserActiveOrg(ctx) {
  const ok = await ctx.eval(`fetch('/api/den/v1/me/active-organization', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationId: ${JSON.stringify(state.orgId)} })
  }).then((response) => response.ok)`, { awaitPromise: true });
  witness(ctx, ok, `The browser session is pinned to ${state.orgName}.`, { organizationId: state.orgId });
}

async function cleanupExistingTelegramConnection(ctx) {
  const existing = await authenticatedApi("/v1/telegram/connection");
  witness(ctx, existing.response.ok, "The owner can read Telegram state before cleanup.", {
    status: existing.response.status,
    connected: Boolean(existing.body?.connection),
  });
  if (!existing.body?.connection) return;
  const removed = await authenticatedApi("/v1/telegram/connection", { method: "DELETE" });
  witness(ctx, removed.response.ok, "A leftover Telegram connection is removed before the proof starts.", {
    status: removed.response.status,
    webhookDeleted: removed.body?.webhookDeleted,
  });
}

async function rememberBrowserSession(ctx) {
  const details = await ctx.eval(`fetch('/api/den/v1/me', { credentials: 'include' })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => ({
      id: payload?.session?.id ?? null,
      token: localStorage.getItem('openwork:web:auth-token') ?? null,
    }))`, { awaitPromise: true });

  if (typeof details?.id === "string" && details.id.length > 0) {
    state.browserSessionId = details.id;
    return;
  }

  if (typeof details?.token === "string" && details.token.length > 0) {
    const rows = await runMysql(ctx, `SELECT id FROM session WHERE token = ${sqlString(details.token)} LIMIT 1;`);
    const sessionId = rows.split(/\r?\n/).map((line) => line.trim()).find((line) => line && line !== "id") ?? null;
    if (sessionId) state.browserSessionId = sessionId;
  }

  ctx.assert(typeof state.browserSessionId === "string" && state.browserSessionId.length > 0, "Could not identify the browser session to stale.");
}

async function clearSessionDataCookies(ctx) {
  if (!ctx.client?.send) return;
  await ctx.client.send("Network.enable").catch((error) => {
    ctx.log(`Network.enable skipped: ${error instanceof Error ? error.message : String(error)}`);
  });
  const cookieResult = await ctx.client.send("Network.getAllCookies", {});
  const cachedSessionCookies = cookieResult.cookies.filter((cookie) => cookie.name.includes("session_data"));
  for (const cookie of cachedSessionCookies) {
    await ctx.client.send("Network.deleteCookies", {
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
    });
  }
}

async function setBrowserSessionAge(ctx, sqlCreatedAt) {
  await rememberBrowserSession(ctx);
  await runMysql(ctx, `UPDATE session SET created_at = ${sqlCreatedAt} WHERE id = ${sqlString(state.browserSessionId)};`);
  await clearSessionDataCookies(ctx);
}

async function staleBrowserSession(ctx) {
  await setBrowserSessionAge(ctx, "DATE_SUB(NOW(3), INTERVAL 1 HOUR)");
}

async function makeBrowserSessionFresh(ctx) {
  await setBrowserSessionAge(ctx, "NOW(3)");
}

async function installTelegramRequestRecorder(ctx) {
  await ctx.eval(`(() => {
    window.__openworkTelegramConnectionRequests = [];
    if (window.__openworkTelegramFetchRecorderInstalled) return true;
    window.__openworkTelegramFetchRecorderInstalled = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const startedAt = performance.now();
      let entry = null;
      try {
        const inputRequest = input instanceof Request ? input : null;
        const rawUrl = inputRequest ? inputRequest.url : String(input);
        const url = new URL(rawUrl, window.location.href);
        const method = String(init?.method ?? inputRequest?.method ?? 'GET').toUpperCase();
        if (method === 'GET' && url.pathname.endsWith('/v1/telegram/connection')) {
          entry = { startedAt, finishedAt: null, method, path: url.pathname, status: null, ok: null, error: null };
          window.__openworkTelegramConnectionRequests.push(entry);
        }
      } catch {
        entry = null;
      }

      try {
        const response = await originalFetch(input, init);
        if (entry) {
          entry.finishedAt = performance.now();
          entry.status = response.status;
          entry.ok = response.ok;
        }
        return response;
      } catch (error) {
        if (entry) {
          entry.finishedAt = performance.now();
          entry.error = error instanceof Error ? error.message : String(error);
        }
        throw error;
      }
    };
    return true;
  })()`);
}

async function resetTelegramRequestRecorder(ctx) {
  await installTelegramRequestRecorder(ctx);
  await ctx.eval("window.__openworkTelegramConnectionRequests = []; true");
}

async function telegramGetRequests(ctx) {
  return ctx.eval("(window.__openworkTelegramConnectionRequests ?? []).map((entry) => ({ ...entry }))");
}

async function openTelegramDialog(ctx) {
  const clicked = await ctx.eval(`(() => {
    const button = document.querySelector('[data-testid="quick-add-telegram"]');
    button?.scrollIntoView({ block: 'center' });
    button?.click();
    return Boolean(button);
  })()`);
  witness(ctx, clicked, "The Telegram quick-add card opens its management dialog.", { clicked });
  await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"telegram-dialog\"]'))", {
    timeoutMs: 20_000,
    label: "Telegram management dialog",
  });
  await ctx.waitFor(`(() => {
    const dialog = document.querySelector('[data-testid="telegram-dialog"]');
    const text = dialog?.textContent ?? '';
    return Boolean(dialog) && !text.includes('Checking Telegram setup…');
  })()`, { timeoutMs: 30_000, label: "Telegram connection status loaded" });
}

async function closeTelegramDialog(ctx) {
  const clicked = await ctx.eval(`(() => {
    const dialog = document.querySelector('[data-testid="telegram-dialog"]');
    const button = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((candidate) => (candidate.textContent ?? '').trim() === 'Close');
    button?.click();
    return Boolean(button);
  })()`);
  witness(ctx, clicked, "The Telegram dialog closes back to Connections.", { clicked });
  await ctx.waitFor("!document.querySelector('[data-testid=\"telegram-dialog\"]')", {
    timeoutMs: 10_000,
    label: "Telegram dialog closed",
  });
}

async function telegramUpdate(text, updateId) {
  const response = await fetch(
    `${MOCK_SERVER_URL}/__mock/telegram/update?text=${encodeURIComponent(text)}&updateId=${encodeURIComponent(updateId)}`,
  );
  if (!response.ok) throw new Error(`Mock Telegram update failed: ${response.status}`);
  return response.json();
}

async function deliverTelegramUpdate(text, updateId) {
  if (!state.webhookUrl || !state.webhookSecret) throw new Error("Telegram webhook was not captured from setup.");
  const update = await telegramUpdate(text, updateId);
  const response = await fetch(state.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": state.webhookSecret,
    },
    body: JSON.stringify(update),
  });
  const body = await response.json().catch(() => null);
  return { response, body, update };
}

async function completeVisibleReauth(ctx) {
  await ctx.waitFor(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog?.textContent ?? '';
    return Boolean(dialog) && text.includes("Confirm it's you to continue") && !text.includes('Checking available sign-in methods');
  })()`, { timeoutMs: 30_000, label: "reauth options loaded" });

  const usedPassword = await ctx.eval(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const input = dialog?.querySelector('input[autocomplete="current-password"]');
    return Boolean(input);
  })()`);

  if (usedPassword) {
    await ctx.fill('[role="dialog"] input[autocomplete="current-password"]', ADMIN_PASSWORD);
    const clicked = await ctx.eval(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const button = [...(dialog?.querySelectorAll('button') ?? [])]
        .find((candidate) => (candidate.textContent ?? '').trim() === 'Verify password' && !candidate.disabled);
      button?.click();
      return Boolean(button);
    })()`);
    witness(ctx, clicked, "The visible password reauthentication form is submitted.", { clicked });
    return;
  }

  const reauthState = await ctx.eval(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return { nonce: dialog?.getAttribute('data-reauth-nonce') ?? null };
  })()`);
  ctx.assert(typeof reauthState?.nonce === "string" && reauthState.nonce.length > 0, "Reauth nonce was missing for the completion seam.");
  await makeBrowserSessionFresh(ctx);
  await ctx.eval(`window.postMessage({ type: 'openwork:reauth-complete', nonce: ${JSON.stringify(reauthState.nonce)}, error: null }, window.location.origin); true`);
  witness(ctx, true, "The visible reauthentication dialog accepts the existing eval completion seam when password auth is unavailable.", {
    noncePresent: true,
  });
}

export default {
  id: FLOW_ID,
  title: "Telegram connection status stays calm on stale sessions while sensitive changes still reauthenticate",
  kind: "user-facing",
  preserveTheme: true,
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_WEB_URL"],
  steps: [
    {
      name: "Setup: mock services, admin org, and disconnected Telegram state are ready",
      run: async (ctx) => {
        const healthResponse = await fetch(`${MOCK_SERVER_URL}/health`).catch(() => null);
        witness(ctx, Boolean(healthResponse?.ok), `Cloud Connect mock is reachable at ${MOCK_SERVER_URL}.`, {
          status: healthResponse?.status ?? null,
        });
        const health = await healthResponse.json();
        witness(ctx, health.service === "cloud-connect-services-mock", "The deterministic Cloud Connect service mock is running.", {
          service: health.service,
          telegramApiBaseUrl: health.endpoints?.telegramApiBaseUrl,
          workerBaseUrl: health.endpoints?.workerBaseUrl,
        });

        state.adminSession = await signInApi(ADMIN_EMAIL, ADMIN_PASSWORD);
        if (!state.adminSession && ctx.env.OPENWORK_EVAL_DEN_TOKEN?.trim()) {
          state.adminSession = ctx.env.OPENWORK_EVAL_DEN_TOKEN.trim();
        }
        witness(ctx, Boolean(state.adminSession), `The demo owner can sign in as ${ADMIN_EMAIL}.`);
        await selectAdminOrganization(ctx);
        await cleanupExistingTelegramConnection(ctx);
        await resetMock(ctx);

        const disconnected = await authenticatedApi("/v1/telegram/connection");
        witness(ctx, disconnected.response.ok && disconnected.body?.connection === null, "The organization starts without a Telegram bot connection.", {
          status: disconnected.response.status,
          connection: disconnected.body?.connection ?? null,
        });
      },
    },
    {
      name: "Frame 1 — Stale admin session can open disconnected Telegram setup",
      run: async (ctx) => {
        await ctx.prove("A stale owner/admin session can read redacted Telegram status and display setup without 403", {
          voiceover: vo[0],
          action: async () => {
            await signInViaBrowser(ctx, ADMIN_EMAIL, ADMIN_PASSWORD);
            await setBrowserActiveOrg(ctx);
            await installTelegramRequestRecorder(ctx);
            await staleBrowserSession(ctx);
            await resetTelegramRequestRecorder(ctx);
            await openAdminConnections(ctx);
            await ctx.waitForText("Telegram", { timeoutMs: 20_000 });
            await openTelegramDialog(ctx);
          },
          assert: async () => {
            await ctx.expectText("Connect Telegram");
            await ctx.expectText("Create a Telegram bot");
            await ctx.expectText("Choose a ready worker");
            const dialog = await ctx.eval(`(() => {
              const element = document.querySelector('[data-testid="telegram-dialog"]');
              const text = element?.textContent ?? '';
              return {
                hasTokenInput: Boolean(element?.querySelector('[data-testid="telegram-bot-token"]')),
                mentions403: text.includes('403'),
                mentionsReauth: text.includes("For security, confirm it's you"),
                mentionsFailure: text.includes('Failed to load Telegram'),
              };
            })()`);
            witness(
              ctx,
              dialog.hasTokenInput && !dialog.mentions403 && !dialog.mentionsReauth && !dialog.mentionsFailure,
              "The stale-session Telegram setup view is rendered instead of a 403 or reauth failure.",
              dialog,
            );

            const requests = await telegramGetRequests(ctx);
            witness(
              ctx,
              requests.some((request) => request.status === 200) && requests.every((request) => request.status !== 403),
              "The browser's stale session GET /v1/telegram/connection succeeds with HTTP 200 and never returns 403.",
              requests,
            );
          },
          screenshot: {
            name: "telegram-stale-session-setup",
            claim: "A stale organization admin session opens the disconnected Telegram setup screen without surfacing a 403 or security reauth banner.",
            requireText: ["Connect Telegram", "Create a Telegram bot", "Choose a ready worker", "Connect bot"],
            rejectText: ["403", "For security, confirm it's you", "Failed to load Telegram", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 2 — Disconnected dialog does not poll forever",
      run: async (ctx) => {
        await ctx.prove("A null Telegram connection stays stable with no interval refetches", {
          voiceover: vo[1],
          action: async () => {
            await ctx.waitFor(`(() => {
              const trigger = document.querySelector('button[aria-label="Telegram worker"]');
              return (trigger?.textContent ?? '').trim() === ${JSON.stringify(WORKER_NAME)};
            })()`, { timeoutMs: 30_000, label: `ready worker ${WORKER_NAME}` });
            await resetTelegramRequestRecorder(ctx);
            await sleep(6_200);
            await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="telegram-dialog"]');
              if (!dialog) return false;
              const boundary = [...dialog.querySelectorAll('p, div, button')]
                .find((element) => (element.textContent ?? '').includes('private text chats only'))
                ?? dialog.querySelector('[data-testid="save-telegram"]');
              boundary?.scrollIntoView({ block: 'center', behavior: 'instant' });
              const before = dialog.scrollTop;
              dialog.scrollTop = Math.max(dialog.scrollTop, dialog.scrollHeight - dialog.clientHeight);
              const trigger = dialog.querySelector('button[aria-label="Telegram worker"]');
              if (dialog.scrollTop === before && trigger instanceof HTMLButtonElement) {
                trigger.scrollIntoView({ block: 'center', behavior: 'instant' });
                trigger.focus({ preventScroll: true });
                if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
              }
              return true;
            })()`);
            await sleep(250);
          },
          assert: async () => {
            const requests = await telegramGetRequests(ctx);
            const body = await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="telegram-dialog"]');
              const trigger = dialog?.querySelector('button[aria-label="Telegram worker"]');
              return {
                visible: Boolean(dialog),
                text: dialog?.textContent ?? '',
                tokenInputVisible: Boolean(dialog?.querySelector('[data-testid="telegram-bot-token"]')),
                scrollTop: dialog?.scrollTop ?? 0,
                worker: trigger?.textContent?.trim() ?? '',
                workerExpanded: trigger?.getAttribute('aria-expanded') === 'true',
              };
            })()`);
            witness(
              ctx,
              requests.length === 0,
              "Leaving the disconnected dialog open for more than two polling intervals issues no repeated Telegram status GETs.",
              { requestCount: requests.length, requests },
            );
            witness(
              ctx,
              body.visible && body.tokenInputVisible && body.worker.includes(WORKER_NAME) && !body.text.includes('Failed') && !body.text.includes('403'),
              "The disconnected setup remains visually stable while idle.",
              { visible: body.visible, tokenInputVisible: body.tokenInputVisible, scrollTop: body.scrollTop, worker: body.worker, workerExpanded: body.workerExpanded },
            );
          },
          screenshot: {
            name: "telegram-disconnected-no-refresh-loop",
            claim: "After sitting open past two old polling intervals, the lower setup section still shows the same worker picker, private-chat boundary, and disabled Connect bot action with no errors.",
            requireText: ["Choose a ready worker", WORKER_NAME, "stable public HTTPS", "private text chats only", "Connect bot"],
            rejectText: ["403", "Failed to load Telegram", "For security, confirm it's you", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 3 — Connecting and pairing stops polling once paired",
      run: async (ctx) => {
        await ctx.prove("The unpaired connection can poll for pairing, then paired status stops the interval", {
          voiceover: vo[2],
          action: async () => {
            await makeBrowserSessionFresh(ctx);
            await ctx.waitFor(`(() => {
              const trigger = document.querySelector('button[aria-label="Telegram worker"]');
              return (trigger?.textContent ?? '').trim() === ${JSON.stringify(WORKER_NAME)};
            })()`, { timeoutMs: 30_000, label: `ready worker ${WORKER_NAME}` });
            await ctx.fill('[data-testid="telegram-bot-token"]', BOT_TOKEN);
            await resetTelegramRequestRecorder(ctx);
            const clicked = await ctx.eval(`(() => {
              const button = document.querySelector('[data-testid="save-telegram"]');
              if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
              button.click();
              return true;
            })()`);
            witness(ctx, clicked, "The admin submits the Telegram bot token and selected worker.", { clicked });

            await ctx.waitForText("Bot and webhook connected", { timeoutMs: 45_000 });
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"telegram-pairing\"]'))", {
              timeoutMs: 30_000,
              label: "one-time Telegram pairing link",
            });
            await sleep(3_200);
            const unpairedRequests = await telegramGetRequests(ctx);
            witness(
              ctx,
              unpairedRequests.length >= 1,
              "While a saved Telegram connection is still unpaired, status checks may continue so the dialog can notice pairing.",
              unpairedRequests,
            );

            const connection = await authenticatedApi("/v1/telegram/connection");
            witness(ctx, connection.response.ok && connection.body?.connection?.pairing?.paired === false, "The management API shows the bot connected but not paired yet.", {
              status: connection.response.status,
              pairing: connection.body?.connection?.pairing,
            });
            state.connectionId = connection.body.connection.id;
            const pairingUrl = await ctx.eval(`document.querySelector('[data-testid="telegram-pairing"] a[href*="t.me/"]')?.href ?? null`);
            const parsedPairingUrl = new URL(pairingUrl);
            state.pairingCode = parsedPairingUrl.searchParams.get("start");
            witness(
              ctx,
              parsedPairingUrl.hostname === "t.me" && parsedPairingUrl.pathname === `/${BOT_USERNAME}` && Boolean(state.pairingCode),
              "The one-time pairing link targets the validated mock bot and includes an opaque start code.",
              { hostname: parsedPairingUrl.hostname, pathname: parsedPairingUrl.pathname, hasOpaqueCode: Boolean(state.pairingCode) },
            );

            const cloud = await mockState();
            state.webhookUrl = cloud.telegram?.webhook?.url ?? null;
            state.webhookSecret = cloud.telegram?.webhook?.secretToken ?? null;
            witness(
              ctx,
              Boolean(state.webhookUrl && state.webhookUrl.endsWith(`/v1/webhooks/telegram/${state.connectionId}`) && state.webhookSecret),
              "Telegram receives a secret-protected webhook for the connected bot.",
              { webhookUrl: state.webhookUrl, secretPresent: Boolean(state.webhookSecret) },
            );

            const delivered = await deliverTelegramUpdate(`/start ${state.pairingCode}`, PAIRING_UPDATE_ID);
            witness(ctx, delivered.response.ok && delivered.body?.accepted === true, "The mock Telegram Start update completes private-chat pairing.", {
              status: delivered.response.status,
              body: delivered.body,
              updateId: delivered.update.update_id,
            });
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"telegram-paired\"]'))", {
              timeoutMs: 45_000,
              label: "paired Telegram private chat in OpenWork",
            });
            await resetTelegramRequestRecorder(ctx);
            await sleep(6_200);
          },
          assert: async () => {
            await ctx.expectText("Bot and webhook connected");
            await ctx.expectText("Private chat paired");
            await ctx.expectText("@openwork_tester");
            const requestsAfterPaired = await telegramGetRequests(ctx);
            witness(
              ctx,
              requestsAfterPaired.length === 0,
              "After pairing becomes true, leaving the connected dialog open for more than two intervals issues no more Telegram status GETs.",
              { requestCount: requestsAfterPaired.length, requestsAfterPaired },
            );
            const connection = await authenticatedApi("/v1/telegram/connection");
            witness(ctx, connection.response.ok && connection.body?.connection?.pairing?.paired === true, "The redacted management status persists the paired private chat.", {
              status: connection.response.status,
              pairing: connection.body?.connection?.pairing,
              connectedLabel: "Bot and webhook connected",
            });
          },
          screenshot: {
            name: "telegram-connected-paired-no-polling",
            claim: "The dialog shows the actual connected labels — Bot and webhook connected plus Private chat paired — and no longer polls once pairing is complete.",
            requireText: ["Telegram bot", "Bot and webhook connected", `@${BOT_USERNAME}`, WORKER_NAME, "Private chat paired", "@openwork_tester"],
            rejectText: ["Not paired yet", "Telegram needs attention", "Failed to load Telegram", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 4 — Stale-session disconnect still reauthenticates and resumes",
      run: async (ctx) => {
        await ctx.prove("Sensitive Telegram disconnect still requires reauthentication, then resumes the pending delete", {
          voiceover: vo[3],
          action: async () => {
            await staleBrowserSession(ctx);
            const openedConfirmation = await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="telegram-dialog"]');
              const button = [...(dialog?.querySelectorAll('button') ?? [])]
                .find((candidate) => (candidate.textContent ?? '').trim() === 'Disconnect');
              button?.scrollIntoView({ block: 'center' });
              button?.click();
              return Boolean(button);
            })()`);
            witness(ctx, openedConfirmation, "The admin chooses Disconnect from the paired Telegram connection.", { openedConfirmation });
            await ctx.waitForText("Disconnect this bot?", { timeoutMs: 10_000 });
            const confirmed = await ctx.eval(`(() => {
              const dialog = document.querySelector('[data-testid="telegram-dialog"]');
              const panel = [...(dialog?.querySelectorAll('div') ?? [])]
                .find((candidate) => (candidate.textContent ?? '').includes('Disconnect this bot?'));
              const button = [...(panel?.querySelectorAll('button') ?? [])]
                .find((candidate) => (candidate.textContent ?? '').trim() === 'Disconnect' && !candidate.disabled);
              button?.click();
              return Boolean(button);
            })()`);
            witness(ctx, confirmed, "The admin confirms the sensitive disconnect action.", { confirmed });
            await ctx.waitFor(`(() => {
              const dialog = document.querySelector('[role="dialog"]');
              const text = dialog?.textContent ?? '';
              return Boolean(dialog) && text.includes("Confirm it's you to continue");
            })()`, { timeoutMs: 30_000, label: "reauth dialog" });
            await ctx.screenshot("telegram-disconnect-visible-reauth", {
              claim: "The stale-session Telegram disconnect opens the visible security confirmation before OpenWork retries the pending action.",
              voiceover: vo[3],
              requireText: ["Security check", "Confirm it's you to continue", "Changing workspace settings requires a recent sign-in", "OpenWork retries the pending action automatically"],
              rejectText: ["Tap to set up", "Failed to disconnect Telegram", "Something went wrong"],
            });
          },
          assert: async () => {
            const reauth = await ctx.eval(`(() => {
              const dialog = document.querySelector('[role="dialog"]');
              const text = dialog?.textContent ?? '';
              return {
                visible: Boolean(dialog),
                title: text.includes("Confirm it's you to continue"),
                helper: text.includes('OpenWork retries the pending action automatically'),
                password: Boolean(dialog?.querySelector('input[autocomplete="current-password"]')),
              };
            })()`);
            witness(
              ctx,
              reauth.visible && reauth.title && reauth.helper,
              "The stale-session DELETE opens the visible security confirmation instead of silently failing.",
              reauth,
            );

            await completeVisibleReauth(ctx);
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"telegram-bot-token\"]'))", {
              timeoutMs: 45_000,
              label: "Telegram returns to disconnected setup after reauth retry",
            });
            const connection = await authenticatedApi("/v1/telegram/connection");
            witness(ctx, connection.response.ok && connection.body?.connection === null, "After reauthentication, the pending disconnect removes Telegram state.", {
              status: connection.response.status,
              connection: connection.body?.connection ?? null,
            });
            await closeTelegramDialog(ctx);
            await ctx.waitFor(`(() => {
              const card = document.querySelector('[data-testid="quick-add-telegram"]');
              card?.scrollIntoView({ block: 'center' });
              return (card?.textContent ?? '').includes('Tap to set up');
            })()`, { timeoutMs: 20_000, label: "Telegram quick-add card reports setup is required" });
          },
          screenshot: {
            name: "telegram-disconnect-after-reauth",
            claim: "The sensitive disconnect action first shows the security confirmation, then returns Telegram to Tap to set up after reauthentication resumes the pending delete.",
            requireText: ["Connections", "Telegram", "Tap to set up"],
            rejectText: ["Connected — tap to manage", "Bot and webhook connected", "Something went wrong"],
          },
        });
      },
    },
  ],
};
