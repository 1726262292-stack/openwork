import { createConnection } from "mysql2/promise";
import { expect } from "vitest";
import {
  denFetch,
  evalIn,
  visibleText,
  waitFor,
  waitForText,
} from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import { navigate } from "@openwork/cdp";
import type { Surface } from "@openwork/cdp";
import { screenshot } from "@openwork/fraimz";
import { chrome } from "@openwork/hosts";
import { app, needs, server, test } from "@openwork/testkit";

const requirements = {
  optIn: ["OPENWORK_EVAL_APP_SPECS", "OPENWORK_EVAL_DYNAMIC_ARTIFACTS_PHASE_2_SPEC"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown, key: string): Record<string, unknown>[] {
  return isRecord(value) && Array.isArray(value[key]) ? value[key].filter(isRecord) : [];
}

async function setField(surface: Surface, label: string, value: string): Promise<void> {
  const changed = await evalIn(surface, `(() => {
    const wanted = ${JSON.stringify(label)};
    const labels = [...document.querySelectorAll('label')];
    const label = labels.find((candidate) => (candidate.textContent ?? '').trim() === wanted)
      ?? labels.find((candidate) => (candidate.textContent ?? '').trim().startsWith(wanted));
    const id = label?.getAttribute('for');
    const field = (id ? document.getElementById(id) : label?.querySelector('input, textarea, select'))
      ?? [...document.querySelectorAll('input, textarea, select')]
        .find((candidate) => (candidate.getAttribute('placeholder') ?? '').includes(wanted));
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return false;
    const prototype = field instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  expect(changed, `Could not set ${label}`).toBe(true);
}

async function clickText(surface: Surface, label: string, options: { contains?: boolean } = {}): Promise<void> {
  const clicked = await evalIn(surface, `(() => {
    const wanted = ${JSON.stringify(label)};
    const contains = ${JSON.stringify(options.contains === true)};
    const element = [...document.querySelectorAll('button, [role="button"], a')]
      .find((candidate) => {
        const text = (candidate.textContent ?? '').trim();
        return contains ? text.includes(wanted) : text === wanted;
      });
    if (!(element instanceof HTMLElement) || element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled')) return false;
    element.click();
    return true;
  })()`);
  expect(clicked, `Could not click ${label}`).toBe(true);
}

async function clickIn(surface: Surface, testId: string, label: string): Promise<void> {
  const clicked = await evalIn(surface, `(() => {
    const root = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
    const element = root && [...root.querySelectorAll('button, [role="tab"]')]
      .find((candidate) => (candidate.textContent ?? '').trim() === ${JSON.stringify(label)});
    if (!(element instanceof HTMLElement) || element.hasAttribute('disabled')) return false;
    element.click();
    return true;
  })()`);
  expect(clicked, `Could not click ${label} in ${testId}`).toBe(true);
}

async function waitForExactText(surface: Surface, testId: string, text: string): Promise<void> {
  await waitFor(surface, `(() => {
    const root = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
    return Boolean(root && [...root.querySelectorAll('*')]
      .some((node) => (node.textContent ?? '').trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())}));
  })()`, { timeoutMs: 120_000, label: `${testId} shows ${text}` });
}

async function readScriptDetail(session: DenSession, configObjectId: string) {
  const result = await denFetch(session, `/v1/codemode-scripts/${encodeURIComponent(configObjectId)}`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  expect(result.response.ok, result.text).toBe(true);
  expect(isRecord(result.body)).toBe(true);
  return result.body as Record<string, unknown>;
}

async function readSnapshots(session: DenSession, configObjectId: string) {
  const result = await denFetch(session, `/v1/codemode-scripts/${encodeURIComponent(configObjectId)}/snapshots?limit=100`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  expect(result.response.ok, result.text).toBe(true);
  return records(result.body, "items");
}

test("Dynamic Artifacts Phase 2 keeps one exact, durable Script lifecycle across desktop and Web", { timeout: 1_500_000 }, async ({ evidence, place }) => {
  needs(requirements);
  await using den = await server({
    place,
    org: { name: `Dynamic Artifacts Phase 2 ${Date.now()}`, admin: { name: "Sarah" } },
  });
  const orgs = await denFetch(den.admin, "/v1/me/orgs", {
    headers: { authorization: `Bearer ${den.admin.token}` },
  });
  const orgRows = records(orgs.body, "orgs");
  const organizationId = String(orgRows[0]?.id ?? "");
  expect(organizationId).not.toBe("");

  const enabled = await denFetch(den.admin, `/v1/admin/organizations/${organizationId}/capabilities`, {
    method: "PUT",
    headers: { authorization: `Bearer ${den.admin.token}` },
    body: JSON.stringify({ capabilities: { codemodeScripts: true } }),
  });
  expect(enabled.response.ok, enabled.text).toBe(true);

  const stamp = Date.now();
  const scriptName = `Phase 2 briefing ${stamp}`;
  const automationName = `Pinned Phase 2 briefing ${stamp}`;
  const v1Marker = `phase-2-v1-${stamp}`;
  const v2Marker = `phase-2-v2-${stamp}`;
  const inputSchema = {
    type: "object",
    properties: { topic: { type: "string" } },
    required: ["topic"],
    additionalProperties: false,
  };
  const outputSchema = {
    type: "object",
    properties: { version: { type: "string" }, topic: { type: "string" } },
    required: ["version", "topic"],
    additionalProperties: false,
  };

  const pluginResponse = await denFetch(den.admin, "/v1/plugins", {
    method: "POST",
    headers: {
      authorization: `Bearer ${den.admin.token}`,
      "x-openwork-org-id": organizationId,
    },
    body: JSON.stringify({
      name: scriptName,
      description: "Fraimz witness for the durable Dynamic Artifact lifecycle.",
      orgWide: true,
      components: [{
        type: "script",
        input: {
          rawSourceText: `return { version: "v1", topic: input.topic }`,
          normalizedPayloadJson: {
            language: "codemode-js",
            inputSchema,
            outputSchema,
            requiredCapabilities: [],
          },
          metadata: { title: scriptName, description: "Durable lifecycle witness" },
        },
      }],
    }),
  });
  expect(pluginResponse.response.status, pluginResponse.text).toBe(201);

  const listed = await denFetch(den.admin, "/v1/codemode-scripts", {
    headers: { authorization: `Bearer ${den.admin.token}` },
  });
  const script = records(listed.body, "items").find((item) => item.title === scriptName);
  expect(script, listed.text).toBeTruthy();
  const pluginId = String(script?.pluginId ?? "");
  const configObjectId = String(script?.configObjectId ?? "");
  const v1VersionId = String(script?.configObjectVersionId ?? "");
  expect(pluginId).not.toBe("");
  expect(configObjectId).not.toBe("");
  expect(v1VersionId).not.toBe("");

  const automationResponse = await denFetch(den.admin, "/v1/automations", {
    method: "POST",
    headers: { authorization: `Bearer ${den.admin.token}` },
    body: JSON.stringify({
      name: automationName,
      schedule: { kind: "daily", timezone: "UTC", hour: 23, minute: 59 },
      action: {
        kind: "saved_script",
        script: { pluginId, configObjectId, configObjectVersionId: v1VersionId },
        input: { topic: v1Marker },
      },
      executionTarget: "cloud",
    }),
  });
  expect(automationResponse.response.status, automationResponse.text).toBe(201);
  const automation = isRecord(automationResponse.body) && isRecord(automationResponse.body.automation)
    ? automationResponse.body.automation
    : null;
  const automationId = String(automation?.id ?? "");
  expect(automationId).not.toBe("");

  await using desktop = await app({ den, as: "admin", place });
  const libraryHash = `#/workspace/${desktop.workspaceId}/extensions`;
  await waitFor(desktop, `(() => {
    const target = ${JSON.stringify(`#/workspace/${desktop.workspaceId}/extensions`)};
    if (location.hash !== target) location.hash = target;
    return [...document.querySelectorAll('h3')]
      .some((candidate) => (candidate.textContent ?? '').trim() === ${JSON.stringify(scriptName)});
  })()`, { timeoutMs: 90_000, label: `saved Script in ${libraryHash}` });
  const opened = await evalIn(desktop, `(() => {
    const heading = [...document.querySelectorAll('h3')]
      .find((candidate) => (candidate.textContent ?? '').trim() === ${JSON.stringify(scriptName)});
    const article = heading?.closest('article');
    const button = article && [...article.querySelectorAll('button')]
      .find((candidate) => (candidate.textContent ?? '').trim() === 'Open');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  expect(opened, "Could not open the saved Script from its Library card").toBe(true);
  await waitFor(desktop, `Boolean(document.querySelector('[data-testid="saved-script-detail"]'))`, {
    timeoutMs: 60_000,
    label: "desktop saved Script detail",
  });
  await waitForText(desktop, "Script editor", { timeoutMs: 30_000 });

  await setField(desktop, "Example input", JSON.stringify({ topic: v1Marker }));
  await clickText(desktop, "Refresh now");
  await waitForText(desktop, v1Marker, { timeoutMs: 120_000 });
  await waitForExactText(desktop, "saved-script-detail", "fresh");
  await clickIn(desktop, "saved-script-artifact-result", "Data");
  await waitForText(desktop, v1Marker, { timeoutMs: 30_000 });
  await clickIn(desktop, "saved-script-artifact-result", "Lineage");
  await waitForText(desktop, "Code digest", { timeoutMs: 30_000 });
  const desktopLineage = await visibleText(desktop);
  expect(desktopLineage).toContain("codemode-markdown-v1");
  expect(desktopLineage).toContain(v1VersionId);
  await evalIn(desktop, `document.querySelector('[data-testid="saved-script-artifact-result"]')?.scrollIntoView({ block: "center" })`);
  const firstDesktopShot = await screenshot(desktop);
  evidence.fact(
    "Desktop renders one retained result as Preview, canonical Data, and exact Lineage",
    `The visible lineage includes Script version ${v1VersionId}, renderer codemode-markdown-v1, and marker ${v1Marker}; screenshot sha256 ${firstDesktopShot.hash}.`,
    true,
  );

  const initialSnapshots = await readSnapshots(den.admin, configObjectId);
  const firstSnapshot = initialSnapshots.find((snapshot) => snapshot.status === "succeeded");
  const firstReceiptId = String(firstSnapshot?.receiptId ?? "");
  expect(firstReceiptId).not.toBe("");
  expect(den.database?.url).toBeTruthy();
  const database = await createConnection(String(den.database?.url));
  try {
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    await database.execute(
      "UPDATE codemode_run SET started_at = ?, finished_at = ? WHERE id = ?",
      [old, old, firstReceiptId],
    );
  } finally {
    await database.end();
  }
  await setField(desktop, "Stale after", String(60 * 60_000));
  await waitForExactText(desktop, "saved-script-detail", "stale");
  evidence.fact(
    "The freshness policy marks an aged retained result stale without deleting it",
    `The isolated Fraimz database aged receipt ${firstReceiptId}; selecting the one-hour policy showed stale while retaining ${v1Marker}.`,
    (await visibleText(desktop)).includes(v1Marker),
  );

  await clickText(desktop, "Refresh now");
  await waitForExactText(desktop, "saved-script-detail", "fresh");

  await setField(desktop, "Source", `return { version: "v2", topic: input.topic }`);
  await setField(desktop, "Example input", JSON.stringify({ topic: v2Marker }));
  await clickText(desktop, "Test changes");
  await waitForText(desktop, "Test output", { timeoutMs: 120_000 });
  await waitForText(desktop, v2Marker, { timeoutMs: 30_000 });
  await clickText(desktop, "Save new version");
  await waitForText(desktop, "Earlier", { timeoutMs: 120_000 });

  const versionedDetail = await readScriptDetail(den.admin, configObjectId);
  const versions = records(versionedDetail, "versions");
  expect(versions).toHaveLength(2);
  const currentVersion = isRecord(versionedDetail.currentVersion) ? versionedDetail.currentVersion : null;
  const v2VersionId = String(currentVersion?.id ?? "");
  expect(v2VersionId).not.toBe(v1VersionId);
  const earlier = versions.find((version) => version.id === v1VersionId);
  expect(records(earlier, "automationReferences").map((item) => item.id)).toContain(automationId);

  const pinnedBeforeUpdate = await denFetch(den.admin, `/v1/automations/${encodeURIComponent(automationId)}`, {
    headers: { authorization: `Bearer ${den.admin.token}` },
  });
  const revisionBefore = isRecord(pinnedBeforeUpdate.body) && isRecord(pinnedBeforeUpdate.body.revision)
    ? pinnedBeforeUpdate.body.revision
    : null;
  const actionBefore = revisionBefore && isRecord(revisionBefore.action) ? revisionBefore.action : null;
  const scriptBefore = actionBefore && isRecord(actionBefore.script) ? actionBefore.script : null;
  expect(scriptBefore?.configObjectVersionId).toBe(v1VersionId);

  await evalIn(desktop, `window.confirm = () => true`);
  await clickText(desktop, automationName, { contains: true });
  await waitFor(desktop, `(() => {
    const text = document.querySelector('[data-testid="saved-script-detail"]')?.textContent ?? '';
    return !text.includes(${JSON.stringify(`Update Automation… · ${automationName}`)});
  })()`, { timeoutMs: 120_000, label: "Automation moved off earlier version" });

  const pinnedAfterUpdate = await denFetch(den.admin, `/v1/automations/${encodeURIComponent(automationId)}`, {
    headers: { authorization: `Bearer ${den.admin.token}` },
  });
  const revisionAfter = isRecord(pinnedAfterUpdate.body) && isRecord(pinnedAfterUpdate.body.revision)
    ? pinnedAfterUpdate.body.revision
    : null;
  const actionAfter = revisionAfter && isRecord(revisionAfter.action) ? revisionAfter.action : null;
  const scriptAfter = actionAfter && isRecord(actionAfter.script) ? actionAfter.script : null;
  expect(scriptAfter?.configObjectVersionId).toBe(v2VersionId);
  evidence.fact(
    "A new immutable Script version does not silently move an Automation pin",
    `Automation ${automationId} remained on ${v1VersionId} until the visible Update Automation action moved it to ${v2VersionId}.`,
    true,
  );

  await setField(desktop, "Example input", JSON.stringify({ topic: v2Marker }));
  await clickText(desktop, "Refresh now");
  await waitForText(desktop, v2Marker, { timeoutMs: 120_000 });
  await waitForExactText(desktop, "saved-script-detail", "fresh");

  await using browser = await chrome({
    name: "dynamic-artifacts-phase-2-web",
    startUrl: den.ref.webUrl,
    headless: true,
    host: place.host(),
  });
  await browser.client.send("Emulation.setDeviceMetricsOverride", {
    width: 1680,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(browser, `location.href.startsWith(${JSON.stringify(den.ref.webUrl)}) && document.readyState === "complete"`, {
    timeoutMs: 60_000,
    label: "Den Web loaded",
  });
  await evalIn(browser, `localStorage.setItem("openwork:web:auth-token", ${JSON.stringify(den.admin.token)})`);
  await navigate(browser.client, `${den.ref.webUrl}/dashboard/plugins/${encodeURIComponent(pluginId)}`);
  await waitForText(browser, scriptName, { timeoutMs: 60_000 });
  await clickText(browser, scriptName, { contains: true });
  await waitFor(browser, `Boolean(document.querySelector('[data-testid="den-saved-script-detail"]'))`, {
    timeoutMs: 60_000,
    label: "Den Web saved Script detail",
  });
  await waitForText(browser, v2Marker, { timeoutMs: 60_000 });
  await clickIn(browser, "den-saved-script-artifact-result", "data");
  await waitForText(browser, v2Marker, { timeoutMs: 30_000 });
  await clickIn(browser, "den-saved-script-artifact-result", "lineage");
  await waitForText(browser, "Code digest", { timeoutMs: 30_000 });
  const webLineage = await visibleText(browser);
  expect(webLineage).toContain(v2VersionId);
  expect(webLineage).toContain("codemode-markdown-v1");
  await evalIn(browser, `document.querySelector('[data-testid="den-saved-script-artifact-result"]')?.scrollIntoView({ block: "center" })`);
  const webShot = await screenshot(browser);
  evidence.fact(
    "Den Web exposes the same exact Dynamic Artifact contract as desktop",
    `Web showed ${v2Marker}, exact Script version ${v2VersionId}, canonical Data, lineage digests, and renderer codemode-markdown-v1; screenshot sha256 ${webShot.hash}.`,
    true,
  );

  await setField(browser, "Example input", JSON.stringify({ topic: 42 }));
  await clickText(browser, "Refresh now");
  await waitForExactText(browser, "den-saved-script-detail", "needs attention");
  await waitForText(browser, "last successful result remains readable", { timeoutMs: 120_000 });
  await clickIn(browser, "den-saved-script-artifact-result", "preview");
  expect(await visibleText(browser)).toContain(v2Marker);

  const failedSnapshots = await readSnapshots(den.admin, configObjectId);
  expect(failedSnapshots[0]?.status).toBe("failed");
  expect(failedSnapshots.some((snapshot) => snapshot.status === "succeeded" && snapshot.value !== null)).toBe(true);
  evidence.fact(
    "A failed refresh is retained but cannot replace the last-good result",
    `Invalid typed input produced failed receipt ${String(failedSnapshots[0]?.receiptId)} while Web continued to show ${v2Marker}.`,
    true,
  );

  await evalIn(browser, `window.confirm = () => true`);
  const deleted = await evalIn(browser, `(() => {
    const section = [...document.querySelectorAll('section')]
      .find((candidate) => (candidate.textContent ?? '').includes('Snapshot history'));
    const rows = section ? [...section.querySelectorAll(':scope > div > div')] : [];
    const succeeded = rows.find((row) => (row.textContent ?? '').trim().startsWith('succeeded') && !(row.textContent ?? '').includes('Content deleted'));
    const button = succeeded?.querySelector('button[aria-label="Delete snapshot content"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  expect(deleted, "Could not delete the newest successful snapshot content").toBe(true);
  await waitForText(browser, "Content deleted", { timeoutMs: 120_000 });
  await waitForText(browser, "Artifact content deleted", { timeoutMs: 120_000 });

  const afterDeletion = await readSnapshots(den.admin, configObjectId);
  const deletedSnapshot = afterDeletion.find((snapshot) => snapshot.contentDeletedAt !== null);
  expect(deletedSnapshot).toBeTruthy();
  expect(deletedSnapshot?.value).toBeNull();
  expect(deletedSnapshot?.markdown).toBeNull();
  expect(deletedSnapshot?.resultDigest).toEqual(expect.any(String));
  expect(deletedSnapshot?.configObjectVersionId).toEqual(expect.any(String));
  const deletionShot = await screenshot(browser);
  evidence.fact(
    "Content deletion removes sensitive payloads while retaining audit facts",
    `Receipt ${String(deletedSnapshot?.receiptId)} retained status, exact Script version, result digest, and timestamps after input/JSON/Markdown deletion; screenshot sha256 ${deletionShot.hash}.`,
    true,
  );
});
