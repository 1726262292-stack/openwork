import { expect, onTestFinished, test } from "vitest";
import { photoRoll, screenshot, validate } from "@openwork/fraimz";
import { desktop } from "@openwork/hosts";
import { startMockMcp } from "@openwork/labs";
import {
  clickButton,
  createAndSelectWorkspace,
  createOrgConnection,
  deleteConnection,
  deleteConnectionsNamed,
  ensureMemberSession,
  evalIn,
  go,
  readAvailableModels,
  readUsableConnection,
  selectModel,
  signIn,
  signInDesktopAs,
  waitFor,
  waitForText,
  writeComposerText,
} from "@openwork/behaviors";
import type { DesktopHandle } from "@openwork/hosts";
import type { DenRef, DenSession } from "@openwork/behaviors";
import type { Surface } from "@openwork/cdp";

/**
 * CORE JOURNEY: an admin publishes one organization MCP connector; two different
 * people each connect their OWN account and then actually use its tools from the
 * composer. Neither inherits the other's credential.
 *
 * Faithfulness notes:
 *  - Two SEPARATE desktops, each with its own isolated profile, signed in as
 *    different members. A single desktop clearing localStorage only simulates
 *    per-member isolation; two desktops make it real.
 *  - The connector itself is the authority on "was it used": we assert on the
 *    tool calls it actually served, and on DISTINCT bearer-token fingerprints,
 *    rather than trusting the app's own "Connected" text.
 *  - The tool call is a real agent task through the product's composer.
 *
 * PLACEMENT: both desktops run on the ambient host today. Moving either onto its
 * own sandbox is `desktop({ host: daytonaSandbox(id) })` — the seam exists; what
 * blocks it is driver-side mode B, not this spec.
 */

const apiUrl = process.env.OPENWORK_EVAL_DEN_API_URL?.trim().replace(/\/+$/, "") ?? "";
const appSpecsEnabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const title = !appSpecsEnabled
  ? "org connector two members skipped: set OPENWORK_EVAL_APP_SPECS=1 to opt in"
  : !apiUrl
    ? "org connector two members skipped: set OPENWORK_EVAL_DEN_API_URL to a running Den"
    : "two members each connect their own account to one org connector and call its tools";

const password = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
const adminEmail = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const aEmail = process.env.OPENWORK_EVAL_MEMBER_EMAIL?.trim() || "jordan.demo@acme.test";
const bEmail = process.env.OPENWORK_EVAL_MEMBER_B_EMAIL?.trim() || "riley.demo@acme.test";
// Zen's free default is not promised to be reliable at tool calls; OPENAI_API_KEY
// is on the eval secrets volume, so a tool-capable model is available when set.
const modelId = process.env.OPENWORK_EVAL_MODEL?.trim() || "";

async function waitForConnectionCard(app: Surface, name: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const found = await evalIn(app, `([...document.querySelectorAll('button')]
      .some((button) => (button.textContent ?? '').includes(${JSON.stringify(name)})))`);
    if (found === true) return;
    await evalIn(app, "window.__openworkControl.execute('extensions.refresh-marketplace', null)", { awaitPromise: true })
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`The connection card ${name} never appeared.`);
}

async function openConnectionDetail(app: Surface, name: string): Promise<void> {
  await waitFor(app, `(() => {
    const card = [...document.querySelectorAll('button')]
      .find((button) => (button.textContent ?? '').includes(${JSON.stringify(name)}));
    if (!card) return false;
    card.click();
    return true;
  })()`, { timeoutMs: 30_000, label: `opened connection detail ${name}` });
}

/** Bring one member's desktop to the org connections surface, signed in as them. */
async function memberDesktop(name: string, den: DenRef, member: DenSession): Promise<{ app: DesktopHandle; workspaceId: string }> {
  const app = await desktop({
    name,
    bootstrap: { baseUrl: den.webUrl, apiBaseUrl: den.webUrl, requireSignin: false },
  });
  // Workspace first, then the org sign-in: the signed-in org shell offers no
  // Add workspace entry, so a member's workspace exists before they connect.
  const path = `/tmp/openwork-${name}-${Date.now()}`;
  await createAndSelectWorkspace(app, { path });
  await signInDesktopAs(app, den, member);
  const { workspaceId } = await createAndSelectWorkspace(app, { path });
  return { app, workspaceId };
}

test.skipIf(!appSpecsEnabled || !apiUrl)(title, async () => {
  const den: DenRef = {
    apiUrl,
    webUrl: (process.env.OPENWORK_EVAL_DEN_WEB_URL?.trim() || apiUrl.replace("127.0.0.1", "localhost")).replace(/\/+$/, ""),
  };
  await using roll = photoRoll("org-connector-two-members");

  // ── The connector we own, with OAuth per member ──────────────────────
  await using conn = await startMockMcp();
  const admin = await signIn(den, { email: adminEmail, password });
  const memberA = await ensureMemberSession(den, admin, {
    email: aEmail,
    password,
    name: "Jordan Demo",
    markVerifiedCmd: process.env.OPENWORK_EVAL_MARK_VERIFIED_CMD?.trim(),
  });
  const memberB = await ensureMemberSession(den, admin, {
    email: bEmail,
    password,
    name: "Riley Demo",
    markVerifiedCmd: process.env.OPENWORK_EVAL_MARK_VERIFIED_CMD?.trim(),
  });

  await deleteConnectionsNamed(admin, "Acme Tickets ");
  const connection = await createOrgConnection(admin, {
    name: `Acme Tickets ${Date.now()}`,
    url: conn.mcpUrl,
    authType: "oauth",
    credentialMode: "per_member",
    access: { orgWide: true },
  });
  onTestFinished(async () => deleteConnection(admin, connection.id));

  // Published, but nobody has connected their own account yet.
  expect((await readUsableConnection(memberA, connection.id))?.connectedForMe).toBe(false);
  expect((await readUsableConnection(memberB, connection.id))?.connectedForMe).toBe(false);

  // ── Member A connects their own account ──────────────────────────────
  const a = await memberDesktop("connector-member-a", den, memberA);
  await using appA = a.app;
  await go(appA, `/workspace/${a.workspaceId}/settings/extensions/connections`);
  await waitForConnectionCard(appA, connection.name);
  await waitForText(appA, "NEEDS YOUR SIGN-IN", { timeoutMs: 60_000 });
  await openConnectionDetail(appA, connection.name);
  await waitForText(appA, "OAuth required", { timeoutMs: 30_000 });
  {
    const shot = await screenshot(appA);
    const seen = await validate(shot, [
      "An organization connection detail is visible saying the person must connect their own account",
      "No 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const aClickedAt = new Date().toISOString();
  await clickButton(appA, "Connect your account");
  await conn.authorizeRequestSince(aClickedAt);
  await waitForText(appA, "Connected with your own account.", { timeoutMs: 120_000 });
  await expect.poll(
    async () => (await readUsableConnection(memberA, connection.id))?.connectedForMe,
    { timeout: 90_000, interval: 1_000 },
  ).toBe(true);
  {
    const shot = await screenshot(appA);
    const seen = await validate(shot, [
      "The connection detail visibly says the person is connected with their own account",
      "No Connect your account action or 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  // ── THE ISOLATION ASSERTION — why two desktops exist ─────────────────
  const b = await memberDesktop("connector-member-b", den, memberB);
  await using appB = b.app;
  await go(appB, `/workspace/${b.workspaceId}/settings/extensions/connections`);
  await waitForConnectionCard(appB, connection.name);
  // A is connected. B must NOT have inherited A's credential.
  await waitForText(appB, "NEEDS YOUR SIGN-IN", { timeoutMs: 60_000 });
  expect((await readUsableConnection(memberB, connection.id))?.connectedForMe).toBe(false);
  expect((await readUsableConnection(memberA, connection.id))?.connectedForMe).toBe(true);
  {
    const shot = await screenshot(appB);
    const seen = await validate(shot, [
      "A second person's app still shows the organization connection needing their own sign-in",
      "No 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }

  const bClickedAt = new Date().toISOString();
  await openConnectionDetail(appB, connection.name);
  await clickButton(appB, "Connect your account");
  await conn.authorizeRequestSince(bClickedAt);
  await waitForText(appB, "Connected with your own account.", { timeoutMs: 120_000 });
  await expect.poll(
    async () => (await readUsableConnection(memberB, connection.id))?.connectedForMe,
    { timeout: 90_000, interval: 1_000 },
  ).toBe(true);

  // ── Both people actually USE it: real tool calls from the composer ───
  const markers: Record<string, string> = {};
  for (const [label, entry] of [["a", a], ["b", b]] as const) {
    const { app, workspaceId } = entry;
    const marker = `${label}-${Date.now()}`;
    markers[label] = marker;

    await go(app, `/workspace/${workspaceId}/session`);
    if (modelId) {
      const models = await readAvailableModels(app);
      expect(
        models.some((model) => model.id === modelId && model.selectable),
        `${modelId} is not selectable under this org's desktop policy. Saw: ${models.map((m) => m.id).join(", ")}`,
      ).toBe(true);
      await selectModel(app, modelId);
    }
    await writeComposerText(app, `Call the mock_echo tool with text exactly "${marker}" and reply with only its result.`);
    await clickButton(app, "Run task");
  }

  // The connector is the witness: two calls, two DISTINCT credentials.
  const calls = await conn.toolCalls({ name: "mock_echo", atLeast: 2, timeoutMs: 240_000 });
  expect(
    calls.length,
    `expected both members to invoke mock_echo. Saw: ${JSON.stringify(calls)}`,
  ).toBeGreaterThanOrEqual(2);
  const texts = calls.map((call) => String(call.args.text ?? ""));
  expect(texts.some((text) => text.includes(markers.a ?? "\u0000"))).toBe(true);
  expect(texts.some((text) => text.includes(markers.b ?? "\u0000"))).toBe(true);
  // Per-member credentials: the two calls cannot share one bearer token.
  const tokenIds = new Set(calls.map((call) => call.tokenId).filter((id): id is string => Boolean(id)));
  expect(
    tokenIds.size,
    `both members' tool calls used the same credential — per-member isolation is broken. Calls: ${JSON.stringify(calls)}`,
  ).toBeGreaterThanOrEqual(2);
  {
    const shot = await screenshot(appB);
    const seen = await validate(shot, [
      "An OpenWork session surface is visible with a task that used the connected organization tool",
      "No 'Something went wrong' crash message is visible",
    ]);
    expect(seen.ok, seen.why).toBe(true);
    await roll.add(shot, seen);
  }
});
