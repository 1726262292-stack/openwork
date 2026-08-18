import { expect } from "vitest";
import { denFetch, evalIn, waitFor } from "@openwork/behaviors";
import { navigate } from "@openwork/cdp";
import { screenshot, validate } from "@openwork/fraimz";
import { chrome } from "@openwork/hosts";
import { needs, server, test, unmetNeeds } from "@openwork/testkit";
import type { NeedsSpec } from "@openwork/testkit";

const requirements: NeedsSpec = {
  optIn: ["OPENWORK_EVAL_APP_SPECS"],
};
const missingRequirements = unmetNeeds(requirements, process.env);
const title = missingRequirements.length > 0
  ? `telegram removal skipped — needs: ${missingRequirements.join(", ")}`
  : "the Telegram integration is gone from the connectors surface and the Den API";

test(title, async ({ evidence, place }) => {
  needs(requirements);
  await using den = await server({
    place,
    org: {
      name: `Telegram Removed Eval ${Date.now()}`,
      admin: { name: "Sarah" },
    },
  });

  // The routes are unregistered, so an authenticated platform admin gets 404
  // (no such route) rather than 401/403, which would only prove authorization.
  const connectionRoute = await denFetch(den.admin, "/v1/telegram/connection", {
    headers: { authorization: `Bearer ${den.admin.token}` },
  });
  const statusRoute = await denFetch(den.admin, "/v1/capabilities/telegram/status", {
    headers: { authorization: `Bearer ${den.admin.token}` },
  });
  const webhookRoute = await denFetch(den.admin, "/v1/webhooks/telegram/tgc_01ffffffffffffffffffffffff", {
    method: "POST",
    headers: { authorization: `Bearer ${den.admin.token}` },
    body: JSON.stringify({}),
  });
  const routesGone = connectionRoute.response.status === 404
    && statusRoute.response.status === 404
    && webhookRoute.response.status === 404;
  expect(connectionRoute.response.status, connectionRoute.text.slice(0, 300)).toBe(404);
  expect(statusRoute.response.status, statusRoute.text.slice(0, 300)).toBe(404);
  expect(webhookRoute.response.status, webhookRoute.text.slice(0, 300)).toBe(404);
  evidence.fact(
    "The Telegram connection, capability-status, and webhook routes are unregistered for an authenticated admin",
    `connection=${connectionRoute.response.status}; status=${statusRoute.response.status}; webhook=${webhookRoute.response.status}`,
    routesGone,
  );

  await using browser = await chrome({
    name: "telegram-removed",
    startUrl: den.ref.webUrl,
    headless: true,
    host: place.host(),
  });
  await browser.client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(browser, `location.href.startsWith(${JSON.stringify(den.ref.webUrl)}) && document.readyState === "complete"`, {
    timeoutMs: 60_000,
    label: "Den Web origin before admin auth token handoff",
  });
  const tokenStored = await evalIn(browser, `(() => {
    localStorage.setItem("openwork:web:auth-token", ${JSON.stringify(den.admin.token)});
    return localStorage.getItem("openwork:web:auth-token") === ${JSON.stringify(den.admin.token)};
  })()`);
  expect(tokenStored).toBe(true);

  await navigate(browser.client, `${den.ref.webUrl}/dashboard/mcp-connections`);
  await waitFor(browser, `(() => {
    const headers = [...document.querySelectorAll("h4")].map((entry) => (entry.textContent ?? "").trim());
    return location.pathname === "/dashboard/mcp-connections"
      && Boolean(document.querySelector('[data-testid="connector-quick-add-grid"]'))
      && headers.includes("From your workspace suite");
  })()`, {
    timeoutMs: 60_000,
    label: "connectors quick-add grid with the workspace suite group",
  });

  const suiteState = await evalIn(browser, `(() => {
    const grid = document.querySelector('[data-testid="connector-quick-add-grid"]');
    const gridText = grid?.textContent ?? "";
    return {
      googleWorkspace: gridText.includes("Google Workspace"),
      microsoft365: gridText.includes("Microsoft 365"),
      telegramText: /telegram/i.test(document.body.innerText),
      telegramTile: Boolean(document.querySelector('[data-testid="quick-add-telegram"]')),
      loadError: document.body.innerText.includes("Failed to load"),
    };
  })()`);
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const surfaceClean = isRecord(suiteState)
    && suiteState.googleWorkspace === true
    && suiteState.microsoft365 === true
    && suiteState.telegramTile === false
    && suiteState.telegramText === false
    && suiteState.loadError === false;
  expect(surfaceClean, JSON.stringify(suiteState)).toBe(true);
  evidence.fact(
    "The workspace-suite quick add still offers Google Workspace and Microsoft 365, with no Telegram tile or Telegram text and no load failure",
    JSON.stringify(suiteState),
    surfaceClean,
  );

  const shot = await screenshot(browser);
  const seen = await validate(shot, [
    "A quick-add section headed From your workspace suite shows Google Workspace and Microsoft 365 tiles",
    "No Telegram tile or Telegram wording appears anywhere on the page",
  ]);
  expect(seen.ok, seen.why).toBe(true);
});
