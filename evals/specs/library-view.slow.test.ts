import { expect, onTestFinished, test } from "vitest";
import { denFetch, ensureMemberSession, evalIn, signIn, waitFor } from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import { navigate } from "@openwork/cdp";
import type { Surface } from "@openwork/cdp";
import { photoRoll, screenshot, validate } from "@openwork/fraimz";
import { chrome } from "@openwork/hosts";

const apiUrl = process.env.OPENWORK_EVAL_DEN_API_URL?.trim().replace(/\/+$/, "") ?? "";
const webUrl = process.env.OPENWORK_EVAL_DEN_WEB_URL?.trim().replace(/\/+$/, "") ?? "";
const title = !apiUrl
  ? "library view skipped: set OPENWORK_EVAL_DEN_API_URL to a running Den API"
  : !webUrl
    ? "library view skipped: set OPENWORK_EVAL_DEN_WEB_URL to a running Den Web"
    : "members can browse their plugin library and its access provenance";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function organizationId(session: DenSession): Promise<string> {
  const result = await denFetch(session, "/v1/me/orgs", {
    headers: { authorization: `Bearer ${session.token}` },
  });
  const orgs = isRecord(result.body) && Array.isArray(result.body.orgs)
    ? result.body.orgs.filter(isRecord)
    : [];
  const organization = orgs.find((entry) => entry.slug === "acme-robotics-demo")
    ?? orgs.find((entry) => entry.name === "Acme Robotics")
    ?? orgs[0];
  const id = organization && typeof organization.id === "string" ? organization.id : "";
  if (!result.response.ok || !id) {
    throw new Error(`Finding Acme Robotics failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  return id;
}

async function selectOrganization(session: DenSession, orgId: string): Promise<void> {
  const result = await denFetch(session, "/v1/me/active-organization", {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ organizationId: orgId }),
  });
  if (!result.response.ok) {
    throw new Error(`Selecting Acme Robotics failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
}

async function organizationMemberIdByEmail(session: DenSession, orgId: string, email: string): Promise<string> {
  const result = await denFetch(session, "/v1/org", {
    headers: {
      authorization: `Bearer ${session.token}`,
      "x-openwork-org-id": orgId,
    },
  });
  const members = isRecord(result.body) && Array.isArray(result.body.members)
    ? result.body.members.filter(isRecord)
    : [];
  const member = members.find((entry) => isRecord(entry.user) && entry.user.email === email);
  const memberId = member && typeof member.id === "string" ? member.id : "";
  if (!result.response.ok || !memberId.startsWith("om_")) {
    throw new Error(`Resolving ${email} in the active organization failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  return memberId;
}

function items(body: unknown): Record<string, unknown>[] {
  return isRecord(body) && Array.isArray(body.items) ? body.items.filter(isRecord) : [];
}

function pluginIdForAccessItem(item: Record<string, unknown>): string {
  return isRecord(item.plugin) && typeof item.plugin.id === "string" ? item.plugin.id : "";
}

function edgesForAccessItem(item: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(item.edges) ? item.edges.filter(isRecord) : [];
}

async function useMobileViewport(browser: Surface): Promise<void> {
  await browser.client.send("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true,
  });
}

test.skipIf(!apiUrl || !webUrl)(title, async () => {
  const den = { apiUrl, webUrl };
  const password = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
  const admin = await signIn(den, {
    email: process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test",
    password,
  });
  const orgId = await organizationId(admin);
  await selectOrganization(admin, orgId);

  let caseySession: DenSession | undefined;
  let pluginId = "";
  let teamId = "";
  onTestFinished(async () => {
    const casey = caseySession;
    const createdPluginId = pluginId;
    const createdTeamId = teamId;
    if (casey && createdPluginId) {
      await denFetch(casey, `/v1/plugins/${encodeURIComponent(createdPluginId)}/archive`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${casey.token}`,
          "x-openwork-org-id": orgId,
        },
      }).catch(() => undefined);
    }
    if (createdTeamId) {
      await denFetch(admin, `/v1/teams/${encodeURIComponent(createdTeamId)}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${admin.token}`,
          "x-openwork-org-id": orgId,
        },
      }).catch(() => undefined);
    }
  });

  const caseyEmail = process.env.OPENWORK_EVAL_CREATOR_EMAIL?.trim() || "casey.spec@acme.test";
  caseySession = await ensureMemberSession(den, admin, {
    email: caseyEmail,
    password: process.env.OPENWORK_EVAL_MEMBER_PASSWORD?.trim() || password,
    name: "Casey Spec",
    markVerifiedCmd: process.env.OPENWORK_EVAL_MARK_VERIFIED_CMD?.trim(),
  });
  const casey = caseySession;
  await selectOrganization(casey, orgId);

  const novaEmail = process.env.OPENWORK_EVAL_MEMBER_EMAIL?.trim() || "nova.spec@acme.test";
  const nova = await ensureMemberSession(den, admin, {
    email: novaEmail,
    password: process.env.OPENWORK_EVAL_MEMBER_PASSWORD?.trim() || password,
    name: "Nova Spec",
    markVerifiedCmd: process.env.OPENWORK_EVAL_MARK_VERIFIED_CMD?.trim(),
  });
  await selectOrganization(nova, orgId);

  const stamp = Date.now();
  const pluginName = `AAA Spec Library Plugin ${stamp}`;
  const skillName = `spec-library-${stamp}`;
  const rawSourceText = `---\nname: ${skillName}\ndescription: Proves the member library view.\n---\n\nReturn the library proof phrase.`;
  const createdPlugin = await denFetch(casey, "/v1/plugins", {
    method: "POST",
    headers: {
      authorization: `Bearer ${casey.token}`,
      "x-openwork-org-id": orgId,
    },
    body: JSON.stringify({
      name: pluginName,
      components: [{ type: "skill", input: { rawSourceText } }],
    }),
  });
  const plugin = isRecord(createdPlugin.body) && isRecord(createdPlugin.body.item) ? createdPlugin.body.item : null;
  pluginId = plugin && typeof plugin.id === "string" ? plugin.id : "";
  if (createdPlugin.response.status !== 201 || !pluginId) {
    throw new Error(`Creating the library plugin failed: HTTP ${createdPlugin.response.status} ${createdPlugin.text.slice(0, 500)}`);
  }

  const novaMemberId = await organizationMemberIdByEmail(casey, orgId, novaEmail);
  const teamName = `Spec Library Provenance Team ${stamp}`;
  const createdTeam = await denFetch(admin, "/v1/teams", {
    method: "POST",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "x-openwork-org-id": orgId,
    },
    body: JSON.stringify({ name: teamName }),
  });
  const team = isRecord(createdTeam.body) && isRecord(createdTeam.body.team) ? createdTeam.body.team : null;
  teamId = team && typeof team.id === "string" ? team.id : "";
  if (createdTeam.response.status !== 201 || !teamId) {
    throw new Error(`Creating the library provenance team failed: HTTP ${createdTeam.response.status} ${createdTeam.text.slice(0, 500)}`);
  }
  const updatedTeam = await denFetch(admin, `/v1/teams/${encodeURIComponent(teamId)}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${admin.token}`,
      "x-openwork-org-id": orgId,
    },
    body: JSON.stringify({ memberIds: [novaMemberId] }),
  });
  if (!updatedTeam.response.ok) {
    throw new Error(`Adding Nova to the library provenance team failed: HTTP ${updatedTeam.response.status} ${updatedTeam.text.slice(0, 500)}`);
  }

  const grantedNova = await denFetch(casey, `/v1/plugins/${encodeURIComponent(pluginId)}/access`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${casey.token}`,
      "x-openwork-org-id": orgId,
    },
    body: JSON.stringify({ orgMembershipId: novaMemberId, role: "viewer" }),
  });
  if (grantedNova.response.status !== 201) {
    throw new Error(`Granting Nova library access failed: HTTP ${grantedNova.response.status} ${grantedNova.text.slice(0, 500)}`);
  }
  const grantedTeam = await denFetch(casey, `/v1/plugins/${encodeURIComponent(pluginId)}/access`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${casey.token}`,
      "x-openwork-org-id": orgId,
    },
    body: JSON.stringify({ teamId, role: "viewer" }),
  });
  if (grantedTeam.response.status !== 201) {
    throw new Error(`Granting the provenance team library access failed: HTTP ${grantedTeam.response.status} ${grantedTeam.text.slice(0, 500)}`);
  }

  const caseyAccess = await denFetch(casey, "/v1/me/plugin-access", {
    headers: {
      authorization: `Bearer ${casey.token}`,
      "x-openwork-org-id": orgId,
    },
  });
  expect(caseyAccess.response.status).toBe(200);
  const caseyPlugin = items(caseyAccess.body).find((item) => pluginIdForAccessItem(item) === pluginId);
  expect(caseyPlugin).toBeDefined();
  if (!caseyPlugin) throw new Error(`Casey's library omitted ${pluginName}: ${caseyAccess.text.slice(0, 500)}`);
  expect(caseyPlugin.role).toBe("manager");
  expect(edgesForAccessItem(caseyPlugin).some((edge) => edge.kind === "mine")).toBe(true);

  const novaAccess = await denFetch(nova, "/v1/me/plugin-access", {
    headers: {
      authorization: `Bearer ${nova.token}`,
      "x-openwork-org-id": orgId,
    },
  });
  expect(novaAccess.response.status).toBe(200);
  const novaItems = items(novaAccess.body);
  const novaPlugin = novaItems.find((item) => pluginIdForAccessItem(item) === pluginId);
  expect(novaPlugin).toBeDefined();
  if (!novaPlugin) throw new Error(`Nova's library omitted ${pluginName}: ${novaAccess.text.slice(0, 500)}`);
  expect(novaPlugin.role).toBe("viewer");
  expect(edgesForAccessItem(novaPlugin).some((edge) => {
    return edge.kind === "person"
      && isRecord(edge.sharedBy)
      && typeof edge.sharedBy.name === "string"
      && edge.sharedBy.name.includes("Casey");
  })).toBe(true);
  expect(novaItems.some((item) => {
    return pluginIdForAccessItem(item) !== pluginId
      && edgesForAccessItem(item).some((edge) => edge.kind === "org_wide" || edge.kind === "catalog");
  })).toBe(true);

  const capabilities = await denFetch(casey, "/v1/resources/marketplace-capabilities", {
    headers: {
      authorization: `Bearer ${casey.token}`,
      "x-openwork-org-id": orgId,
    },
  });
  expect(capabilities.response.status).toBe(200);
  expect(items(capabilities.body).some((item) => item.pluginId === pluginId && item.marketplaceId === null)).toBe(true);

  await using browser = await chrome({ name: "p3-library", startUrl: webUrl, headless: true });
  await waitFor(browser, `location.href.startsWith(${JSON.stringify(webUrl)}) && document.readyState === "complete"`, {
    timeoutMs: 60_000,
    label: "Den Web origin before Nova auth token handoff",
  });
  const tokenStored = await evalIn(browser, `(() => {
    localStorage.setItem("openwork:web:auth-token", ${JSON.stringify(nova.token)});
    return localStorage.getItem("openwork:web:auth-token") === ${JSON.stringify(nova.token)};
  })()`);
  expect(tokenStored).toBe(true);

  await navigate(browser.client, `${webUrl}/dashboard/library`);
  try {
    await waitFor(
      browser,
      `document.body.innerText.includes("Library")
        && document.body.innerText.includes(${JSON.stringify(pluginName)})
        && document.body.innerText.includes("Shared by Casey")`,
      { timeoutMs: 60_000, label: "member library, shared plugin, and Casey provenance" },
    );
  } catch (error) {
    const pageState = await evalIn(browser, `({ href: location.href, text: document.body.innerText.slice(0, 1000) })`);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} Page state: ${JSON.stringify(pageState)}`);
  }
  const libraryNavPresent = await evalIn(
    browser,
    `[...document.querySelectorAll("aside, nav")].some((entry) => (entry.textContent ?? "").includes("Library"))`,
  );
  expect(libraryNavPresent).toBe(true);

  await using roll = photoRoll("p3-library");
  const desktopShot = await screenshot(browser);
  const desktopSeen = await validate(desktopShot, [
    "A library page lists plugin cards with provenance chips",
    "A chip reading Shared by is visible",
  ]);
  await roll.add(desktopShot, desktopSeen);
  expect(desktopSeen.ok, desktopSeen.why).toBe(true);

  await useMobileViewport(browser);
  await new Promise((resolve) => setTimeout(resolve, 500));
  await waitFor(browser, `document.body.innerText.includes(${JSON.stringify(pluginName)})`, {
    timeoutMs: 60_000,
    label: "shared plugin after mobile reflow",
  });
  const mobileShot = await screenshot(browser);
  const mobileSeen = await validate(mobileShot, [
    "A narrow mobile layout shows library cards in a single column",
    "Provenance chips wrap and remain readable",
  ]);
  await roll.add(mobileShot, mobileSeen);
  expect(mobileSeen.ok, mobileSeen.why).toBe(true);
});
