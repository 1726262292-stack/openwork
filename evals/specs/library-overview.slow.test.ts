import { expect } from "vitest";
import { createOrgConnection, denFetch, evalIn, waitFor } from "@openwork/behaviors";
import type { DenSession } from "@openwork/behaviors";
import { navigate } from "@openwork/cdp";
import type { Surface } from "@openwork/cdp";
import { screenshot, validate } from "@openwork/fraimz";
import { chrome } from "@openwork/hosts";
import { mcpMock, needs, server, test, unmetNeeds } from "@openwork/testkit";
import type { NeedsSpec } from "@openwork/testkit";

const requirements: NeedsSpec = {
  optIn: ["OPENWORK_EVAL_APP_SPECS"],
};
const missingRequirements = unmetNeeds(requirements, process.env);
const title = missingRequirements.length > 0
  ? `library overview skipped — needs: ${missingRequirements.join(", ")}`
  : "a member lands on a library overview that summarises connections, models, skills, and plugins";

const REQUEST_TIMEOUT_MS = 15_000;
/** Enough to overflow the row cap and prove "Show more". */
const SKILL_COUNT = 16;
/** Three 75px icon rows with 10px gaps. */
const ICON_FLOW_MAX_HEIGHT = 245;
/** Twelve 15px rows with 5px gaps — as close as it gets to the icon flow height. */
const ROW_FLOW_MAX_HEIGHT = 235;
const VISIBLE_ROWS = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function auth(session: DenSession, orgId: string): Record<string, string> {
  return { authorization: `Bearer ${session.token}`, "x-openwork-org-id": orgId };
}

async function organizationId(session: DenSession): Promise<string> {
  const result = await denFetch(session, "/v1/me/orgs", {
    headers: { authorization: `Bearer ${session.token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const orgs = isRecord(result.body) && Array.isArray(result.body.orgs) ? result.body.orgs.filter(isRecord) : [];
  const id = orgs[0] && typeof orgs[0].id === "string" ? orgs[0].id : "";
  if (!result.response.ok || !id) {
    throw new Error(`Finding the active organization failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
  return id;
}

async function selectOrganization(session: DenSession, orgId: string): Promise<void> {
  const result = await denFetch(session, "/v1/me/active-organization", {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ organizationId: orgId }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!result.response.ok) {
    throw new Error(`Selecting the organization failed: HTTP ${result.response.status} ${result.text.slice(0, 500)}`);
  }
}

/** Mirrors the product's connection state → dot colour mapping. */
function expectedTone(state: unknown): string {
  if (state === "connected") return "success";
  if (state === "needs_signin") return "warning";
  if (state === "needs_admin_setup") return "danger";
  return "info";
}

async function gridTrackCount(browser: Surface): Promise<unknown> {
  return evalIn(browser, `(() => {
    const grid = document.querySelector("[data-library-overview-grid]");
    if (!(grid instanceof HTMLElement)) return 0;
    return getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
  })()`);
}

async function cardTitles(browser: Surface): Promise<unknown> {
  return evalIn(browser, `[...document.querySelectorAll("[data-library-card]")]
    .map((card) => card.getAttribute("data-library-card")).join(",")`);
}

test(title, async ({ evidence, place }) => {
  needs(requirements);

  await using den = await server({
    place,
    org: {
      name: `Library Overview ${Date.now()}`,
      admin: { name: "Avery Admin" },
      members: { nova: { name: "Nova Member" } },
    },
    mocks: { connector: mcpMock() },
  });

  const nova = den.members.nova;
  if (!nova) throw new Error("The testkit did not provision the invited member.");

  const orgId = await organizationId(den.admin);
  await selectOrganization(den.admin, orgId);
  await selectOrganization(nova, orgId);

  // A per-member OAuth connection nobody has signed into yet: the one thing on
  // the overview that Nova can act on herself.
  const connection = await createOrgConnection(den.admin, {
    name: `Overview Linear ${Date.now()}`,
    url: den.mocks.connector.mcpUrl,
    authType: "oauth",
    credentialMode: "per_member",
    access: { orgWide: true },
  });
  // A shared credential with nothing configured is what "waiting on an admin"
  // looks like, and Nova must never see it on the summary.
  const blockedConnection = await createOrgConnection(den.admin, {
    name: `Overview Blocked ${Date.now()}`,
    url: den.mocks.connector.mcpUrl,
    authType: "oauth",
    credentialMode: "shared",
    access: { orgWide: true },
  });

  const stamp = Date.now();
  const pluginName = `Overview Bundle ${stamp}`;
  const skillTitles = Array.from({ length: SKILL_COUNT }, (_, index) => `overview-skill-${stamp}-${index}`);
  const components = [
    ...skillTitles.map((skillTitle) => ({
      type: "skill",
      input: { rawSourceText: `---\nname: ${skillTitle}\ndescription: Proves the library overview.\n---\n\nReturn the overview proof phrase.` },
    })),
    {
      type: "agent",
      input: { rawSourceText: `---\nname: overview-agent-${stamp}\ndescription: Proves per-kind badges.\n---\n\nAct as the overview agent.` },
    },
  ];
  const createdPlugin = await denFetch(den.admin, "/v1/plugins", {
    method: "POST",
    headers: auth(den.admin, orgId),
    body: JSON.stringify({ name: pluginName, components, orgWide: true }),
    signal: AbortSignal.timeout(60_000),
  });
  if (createdPlugin.response.status !== 201) {
    throw new Error(`Creating the overview plugin failed: HTTP ${createdPlugin.response.status} ${createdPlugin.text.slice(0, 500)}`);
  }

  const providerName = `Overview Gateway ${stamp}`;
  const createdProvider = await denFetch(den.admin, "/v1/llm-providers", {
    method: "POST",
    headers: auth(den.admin, orgId),
    body: JSON.stringify({
      name: providerName,
      source: "custom",
      customConfig: {
        id: `overview-gateway-${stamp}`,
        name: providerName,
        npm: "@ai-sdk/openai-compatible",
        env: ["OVERVIEW_GATEWAY_API_KEY"],
        models: [{ id: "overview-model", name: "Overview Model" }],
      },
      allMembers: true,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (createdProvider.response.status !== 201) {
    throw new Error(`Creating the overview provider failed: HTTP ${createdProvider.response.status} ${createdProvider.text.slice(0, 500)}`);
  }

  const library = await denFetch(nova, "/v1/me/library", {
    headers: auth(nova, orgId),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  expect(library.response.status).toBe(200);
  const libraryItems = isRecord(library.body) && Array.isArray(library.body.items)
    ? library.body.items.filter(isRecord)
    : [];
  const apiConnections = libraryItems.filter((item) => item.type === "connection");
  const apiPlugin = libraryItems.find((item) => item.type === "plugin" && item.name === pluginName);
  if (!apiPlugin) throw new Error(`Nova's library omitted ${pluginName}: ${library.text.slice(0, 500)}`);

  evidence.fact(
    "Per-kind component counts reach the member",
    "The library API reports the bundle's skills and agents separately, not just a total.",
    isRecord(apiPlugin.componentCounts)
      && apiPlugin.componentCounts.skill === SKILL_COUNT
      && apiPlugin.componentCounts.agent === 1,
  );
  expect(apiPlugin.componentCounts).toMatchObject({ skill: SKILL_COUNT, agent: 1 });

  await using browser = await chrome({
    name: "library-overview",
    startUrl: den.ref.webUrl,
    headless: true,
    host: place.host(),
  });
  await browser.client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(browser, `location.href.startsWith(${JSON.stringify(den.ref.webUrl)}) && document.readyState === "complete"`, {
    timeoutMs: 60_000,
    label: "Den Web origin before member auth token handoff",
  });
  const tokenStored = await evalIn(browser, `(() => {
    localStorage.setItem("openwork:web:auth-token", ${JSON.stringify(nova.token)});
    return localStorage.getItem("openwork:web:auth-token") === ${JSON.stringify(nova.token)};
  })()`);
  expect(tokenStored).toBe(true);

  // ── Frame 1: the landing page is an overview, not a list ──
  await navigate(browser.client, `${den.ref.webUrl}/dashboard/library`);
  await waitFor(browser, `(() => {
    const cards = [...document.querySelectorAll("[data-library-card]")];
    return [...document.querySelectorAll("h1")].some((entry) => entry.textContent?.trim() === "Library")
      && cards.length === 4;
  })()`, { timeoutMs: 60_000, label: "library overview grid with four cards" });

  const titles = await cardTitles(browser);
  evidence.fact(
    "The overview shows four cards in a fixed order",
    "Connections, Models, Skills, and Plugins each get their own card, in that order.",
    titles === "connections,models,skills,plugins",
  );
  expect(titles).toBe("connections,models,skills,plugins");

  const desktopTracks = await gridTrackCount(browser);
  evidence.fact(
    "The overview is a 2x2 grid on desktop",
    "The card grid resolves to exactly two columns at 1440px, so four cards form two rows.",
    desktopTracks === 2,
  );
  expect(desktopTracks).toBe(2);

  const listRowsOnOverview = await evalIn(browser, `document.querySelectorAll("[data-library-item-type]").length`);
  evidence.fact(
    "The overview does not render the full library list",
    "None of the detailed list rows appear on the landing page, so the overview stays a summary.",
    listRowsOnOverview === 0,
  );
  expect(listRowsOnOverview).toBe(0);

  // ── Frame 2: connection icons carry status colours ──
  await waitFor(browser, `document.querySelectorAll('[data-library-card="connections"] [data-library-icon]').length > 0`, {
    timeoutMs: 60_000,
    label: "connection icon tiles",
  });
  const renderedTones = await evalIn(browser, `(() => {
    const tiles = [...document.querySelectorAll('[data-library-card="connections"] [data-library-icon]')];
    return JSON.stringify(tiles.map((tile) => ({
      key: tile.getAttribute("data-library-item-key"),
      tone: tile.querySelector("[data-library-status]")?.getAttribute("data-library-status") ?? null,
    })));
  })()`);
  const toneByKey = new Map<string, string | null>(
    (JSON.parse(String(renderedTones)) as { key: string; tone: string | null }[]).map((entry) => [entry.key, entry.tone]),
  );
  // The summary deliberately drops admin-blocked connections, so only the
  // actionable ones should be present — and their colours must still be right.
  const actionable = apiConnections.filter((item) => item.state !== "needs_admin_setup");
  const blocked = apiConnections.filter((item) => item.state === "needs_admin_setup");
  const everyToneMatches = actionable.every((item) =>
    toneByKey.get(`connection-${String(item.id)}`) === expectedTone(item.state));
  evidence.fact(
    "Every connection dot matches its real status",
    "Each rendered connection tile carries the colour its API state implies: green ready, amber sign-in, blue available.",
    actionable.length > 0 && everyToneMatches,
  );
  expect(everyToneMatches).toBe(true);
  evidence.fact(
    "Connections waiting on an admin stay out of the summary",
    "The shared-credential connection resolves to needs_admin_setup and renders no tile, because the member cannot act on it.",
    blocked.some((item) => item.id === blockedConnection.id)
      && blocked.every((item) => !toneByKey.has(`connection-${String(item.id)}`)),
  );
  expect(blocked.map((item) => item.id)).toContain(blockedConnection.id);
  expect(toneByKey.has(`connection-${blockedConnection.id}`)).toBe(false);
  expect([...toneByKey.values()]).not.toContain("danger");
  evidence.fact(
    "The unsigned connection reads as the member's own action",
    "The seeded per-member connection shows the amber sign-in dot rather than ready, blocked, or available.",
    toneByKey.get(`connection-${connection.id}`) === "warning",
  );
  expect(toneByKey.get(`connection-${connection.id}`)).toBe("warning");

  const tileLinks = await evalIn(browser, `(() => {
    const tile = document.querySelector('[data-library-item-key="connection-${connection.id}"]');
    const link = tile?.closest("a");
    const modelTile = document.querySelector('[data-library-card="models"] [data-library-icon]');
    return JSON.stringify({
      href: link instanceof HTMLAnchorElement ? link.getAttribute("href") : null,
      modelIsLink: Boolean(modelTile?.closest("a")),
    });
  })()`);
  const links = JSON.parse(String(tileLinks)) as { href: string | null; modelIsLink: boolean };
  evidence.fact(
    "A connection icon opens that connection",
    "Clicking a connection tile goes to Your Connections deep-linked to that connection id.",
    links.href !== null
      && links.href.includes("your-connections")
      && links.href.includes(encodeURIComponent(connection.id)),
  );
  expect(links.href).toContain("your-connections");
  expect(links.href).toContain(encodeURIComponent(connection.id));
  evidence.fact(
    "Only connection tiles navigate",
    "Model tiles carry no link, so the click affordance is limited to connections.",
    links.modelIsLink === false,
  );
  expect(links.modelIsLink).toBe(false);

  // ── Frame 3: hover/focus names the item and its status ──
  const tooltipHiddenBefore = await evalIn(browser, `(() => {
    const tile = document.querySelector('[data-library-item-key="connection-${connection.id}"]');
    const trigger = tile?.closest("[aria-describedby]");
    const describedBy = trigger?.getAttribute("aria-describedby") ?? "";
    const tooltip = describedBy ? document.getElementById(describedBy) : null;
    return tooltip instanceof HTMLElement ? tooltip.hasAttribute("hidden") : null;
  })()`);
  evidence.fact(
    "The tooltip stays out of the way until asked for",
    "The status tooltip is hidden before the member hovers or focuses the tile.",
    tooltipHiddenBefore === true,
  );
  expect(tooltipHiddenBefore).toBe(true);

  const opened = await evalIn(browser, `(() => {
    const tile = document.querySelector('[data-library-item-key="connection-${connection.id}"]');
    const trigger = tile?.closest("[aria-describedby]");
    if (!(trigger instanceof HTMLElement)) return false;
    trigger.focus();
    return document.activeElement === trigger;
  })()`);
  expect(opened).toBe(true);
  await waitFor(browser, `(() => {
    const tooltip = [...document.querySelectorAll("[data-den-tooltip][data-open]")]
      .find((entry) => (entry.textContent ?? "").includes(${JSON.stringify(connection.name)}));
    return Boolean(tooltip && (tooltip.textContent ?? "").includes("Sign In to Use"));
  })()`, { timeoutMs: 30_000, label: "tooltip naming the connection and its status" });

  const tooltipText = await evalIn(browser, `(() => {
    const tooltip = [...document.querySelectorAll("[data-den-tooltip][data-open]")]
      .find((entry) => (entry.textContent ?? "").includes(${JSON.stringify(connection.name)}));
    return tooltip?.textContent ?? "";
  })()`);
  evidence.fact(
    "The tooltip states the item and what to do about it",
    "Focusing the tile reveals a tooltip naming the connection and saying Sign In to Use.",
    String(tooltipText).includes(connection.name) && String(tooltipText).includes("Sign In to Use"),
  );
  expect(String(tooltipText)).toContain("Sign In to Use");

  const legacyWording = await evalIn(browser, `document.body.innerText.includes("Needs your sign-in")`);
  evidence.fact(
    "The old sign-in wording is gone",
    "The library never says 'Needs your sign-in' anywhere on the page.",
    legacyWording === false,
  );
  expect(legacyWording).toBe(false);

  // ── Frame 4: models are provider icons with the model name over them ──
  await waitFor(browser, `document.querySelectorAll('[data-library-card="models"] [data-library-icon]').length > 0`, {
    timeoutMs: 60_000,
    label: "model tiles",
  });
  const modelTile = await evalIn(browser, `(() => {
    const tiles = [...document.querySelectorAll('[data-library-card="models"] [data-library-icon]')];
    const tile = tiles.find((entry) => (entry.textContent ?? "").includes(${JSON.stringify(providerName)}));
    if (!tile) return JSON.stringify({ found: false });
    const icon = tile.querySelector("span");
    return JSON.stringify({
      found: true,
      tone: tile.querySelector("[data-library-status]")?.getAttribute("data-library-status") ?? null,
      faded: icon instanceof HTMLElement ? Number(getComputedStyle(icon).opacity) < 1 : null,
      allGreen: tiles.every((entry) =>
        entry.querySelector("[data-library-status]")?.getAttribute("data-library-status") === "success"),
    });
  })()`);
  const model = JSON.parse(String(modelTile)) as {
    found: boolean;
    tone: string | null;
    faded: boolean | null;
    allGreen: boolean;
  };
  evidence.fact(
    "A custom provider appears as one tile named by its configuration",
    "The custom provider contributes a single tile whose overlaid label is the configured provider name.",
    model.found,
  );
  expect(model.found).toBe(true);
  evidence.fact(
    "The model name sits over a faded provider icon",
    "The provider logo is rendered behind the label at reduced opacity, so the model name reads first.",
    model.faded === true,
  );
  expect(model.faded).toBe(true);
  evidence.fact(
    "Every model reads as ready",
    "All model tiles carry the green dot, because a listed model is already granted to the member.",
    model.allGreen,
  );
  expect(model.allGreen).toBe(true);

  const connectionInModels = await evalIn(
    browser,
    `document.querySelector('[data-library-card="models"]')?.textContent?.includes(${JSON.stringify(connection.name)}) ?? null`,
  );
  evidence.fact(
    "Models and connections stay in their own cards",
    "The models card does not list the seeded connection.",
    connectionInModels === false,
  );
  expect(connectionInModels).toBe(false);

  // ── Frame 5: slim rows with per-kind badges ──
  await waitFor(browser, `(() => {
    const pluginRow = document.querySelector('[data-library-card="plugins"] [data-library-row]');
    return Boolean(pluginRow && (pluginRow.textContent ?? "").includes(${JSON.stringify(pluginName)}));
  })()`, { timeoutMs: 60_000, label: "plugin row on the overview" });

  const badges = await evalIn(browser, `(() => {
    const row = [...document.querySelectorAll('[data-library-card="plugins"] [data-library-row]')]
      .find((entry) => (entry.textContent ?? "").includes(${JSON.stringify(pluginName)}));
    return [...(row?.querySelectorAll("[data-library-row-badge]") ?? [])]
      .map((badge) => (badge.textContent ?? "").trim()).join("|");
  })()`);
  evidence.fact(
    "A plugin row counts what is inside it",
    "The bundle row shows its skill and agent counts, so a bundle reads differently from a single skill.",
    String(badges).includes(`${SKILL_COUNT} skills`) && String(badges).includes("1 agent"),
  );
  expect(String(badges)).toContain(`${SKILL_COUNT} skills`);
  expect(String(badges)).toContain("1 agent");
  evidence.fact(
    "Absent component kinds get no badge",
    "The row shows no commands or MCPs badge, because the bundle contains none.",
    !String(badges).includes("command") && !String(badges).includes("MCP"),
  );
  expect(String(badges)).not.toContain("command");

  await waitFor(browser, `(() => {
    const rows = [...document.querySelectorAll('[data-library-card="skills"] [data-library-row]')];
    return rows.some((row) => (row.textContent ?? "").includes(${JSON.stringify(skillTitles[0])}));
  })()`, { timeoutMs: 60_000, label: "skill rows on the overview" });

  // ── Frame 6: every card stops at the same height, the rest behind Show more ──
  const clamp = await evalIn(browser, `(() => {
    const read = (card) => {
      const root = document.querySelector('[data-library-card="' + card + '"]');
      const content = root?.querySelector("[data-library-flow-content]");
      if (!(content instanceof HTMLElement)) return null;
      return {
        maxHeight: getComputedStyle(content).maxHeight,
        overflowing: content.scrollHeight > content.clientHeight + 1,
        showMore: Boolean(root?.querySelector("[data-library-show-more]")),
      };
    };
    return JSON.stringify({ skills: read("skills"), plugins: read("plugins"), connections: read("connections") });
  })()`);
  const clamped = JSON.parse(String(clamp)) as Record<string, { maxHeight: string; overflowing: boolean; showMore: boolean } | null>;
  evidence.fact(
    "Row and icon flows are capped to the same height",
    `The row flow clamps at ${ROW_FLOW_MAX_HEIGHT}px and the icon flow at ${ICON_FLOW_MAX_HEIGHT}px, so cards line up.`,
    clamped.skills?.maxHeight === `${ROW_FLOW_MAX_HEIGHT}px`
      && clamped.connections?.maxHeight === `${ICON_FLOW_MAX_HEIGHT}px`,
  );
  expect(clamped.skills?.maxHeight).toBe(`${ROW_FLOW_MAX_HEIGHT}px`);
  expect(clamped.connections?.maxHeight).toBe(`${ICON_FLOW_MAX_HEIGHT}px`);
  evidence.fact(
    "Overflow hides behind Show more",
    `${SKILL_COUNT} skills exceed the ${VISIBLE_ROWS} visible rows, so the skills card offers Show more.`,
    clamped.skills?.overflowing === true && clamped.skills?.showMore === true,
  );
  expect(clamped.skills?.overflowing).toBe(true);
  expect(clamped.skills?.showMore).toBe(true);
  evidence.fact(
    "A card that fits offers no Show more",
    "The single-plugin card neither overflows nor shows the Show more affordance.",
    clamped.plugins?.overflowing === false && clamped.plugins?.showMore === false,
  );
  expect(clamped.plugins?.showMore).toBe(false);

  const expandedSkills = await evalIn(browser, `(() => {
    const button = document.querySelector('[data-library-card="skills"] [data-library-show-more]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  })()`);
  expect(expandedSkills).toBe(true);
  await waitFor(browser, `(() => {
    const content = document.querySelector('[data-library-card="skills"] [data-library-flow-content]');
    return content instanceof HTMLElement
      && content.hasAttribute("data-library-flow-expanded")
      && content.scrollHeight <= content.clientHeight + 1;
  })()`, { timeoutMs: 30_000, label: "expanded skills card revealing every row" });
  evidence.fact(
    "Show more reveals the rest in place",
    "Expanding the skills card removes the clamp so every remaining row becomes visible.",
    true,
  );

  const overviewShot = await screenshot(browser);
  const overviewSeen = await validate(overviewShot, [
    "Four cards titled Connections, Models, Skills and Plugins form a two-by-two grid",
    "The Connections card shows a dense flow of app icons, each with a small coloured status dot",
  ]);
  expect(overviewSeen.ok, overviewSeen.why).toBe(true);

  // ── Frame 7: the detail page expands a card into full rows behind tabs ──
  const openedConnections = await evalIn(browser, `(() => {
    const link = document.querySelector('[data-library-card="connections"] a');
    if (!(link instanceof HTMLElement)) return false;
    link.click();
    return true;
  })()`);
  expect(openedConnections).toBe(true);
  await waitFor(browser, `location.pathname.includes("/dashboard/library/details")
    && location.search.includes("tab=connections")`, {
    timeoutMs: 60_000,
    label: "connections deep link into the library detail page",
  });

  const detailTabs = await evalIn(browser, `[...document.querySelectorAll('[role="tablist"][aria-label="Library sections"] [role="tab"]')]
    .map((tab) => (tab.textContent ?? "").replace(/[0-9]+$/, "").trim()).join(",")`);
  evidence.fact(
    "The detail page opens on tabs named after the cards",
    "Overview leads, then one tab per overview card: Connections, Models, Skills, Plugins.",
    String(detailTabs) === "Overview,Connections,Models,Skills,Plugins",
  );
  expect(String(detailTabs)).toBe("Overview,Connections,Models,Skills,Plugins");

  await waitFor(browser, `(() => {
    const row = [...document.querySelectorAll('[data-library-item-type="connection"]')]
      .find((entry) => (entry.textContent ?? "").includes(${JSON.stringify(connection.name)}));
    const signIn = row ? [...row.querySelectorAll("a")].find((entry) => entry.textContent?.trim() === "Sign in") : null;
    return Boolean(signIn?.getAttribute("href")?.includes("your-connections"));
  })()`, { timeoutMs: 60_000, label: "expanded connection row with a way to act on it" });

  const renamedWording = await evalIn(browser, `(() => {
    const caption = document.querySelector('[data-library-section="needs_signin"] h2');
    const stateTabs = [...document.querySelectorAll('[role="tablist"][aria-label="Library state"] [role="tab"]')]
      .map((tab) => (tab.textContent ?? "").trim());
    return JSON.stringify({
      caption: caption?.textContent?.trim() ?? null,
      hasStateTab: stateTabs.some((label) => label.startsWith("Sign In to Use")),
    });
  })()`);
  const renamed = JSON.parse(String(renamedWording)) as { caption: string | null; hasStateTab: boolean };
  evidence.fact(
    "The expanded list uses the new sign-in wording",
    "The readiness section is captioned SIGN IN TO USE and its state tab reads Sign In to Use.",
    renamed.caption === "SIGN IN TO USE" && renamed.hasStateTab,
  );
  expect(renamed.caption).toBe("SIGN IN TO USE");
  expect(renamed.hasStateTab).toBe(true);

  const pluginRowsOnConnectionsTab = await evalIn(
    browser,
    `document.querySelectorAll('[data-library-item-type="plugin"]').length`,
  );
  evidence.fact(
    "A card's tab shows only that card's items",
    "The connections tab lists no plugin rows, so the tab honours the card the member came from.",
    pluginRowsOnConnectionsTab === 0,
  );
  expect(pluginRowsOnConnectionsTab).toBe(0);

  const detailShot = await screenshot(browser);
  const detailSeen = await validate(detailShot, [
    "A tab bar sits under the Library header with Overview, Connections, Models, Skills and Plugins",
    "A connection row shows its status and a Sign in button",
  ]);
  expect(detailSeen.ok, detailSeen.why).toBe(true);

  // ── Frame 8: one column on a phone, same order ──
  await navigate(browser.client, `${den.ref.webUrl}/dashboard/library`);
  await waitFor(browser, `document.querySelectorAll("[data-library-card]").length === 4`, {
    timeoutMs: 60_000,
    label: "overview cards before the mobile reflow",
  });
  await browser.client.send("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await waitFor(browser, `(() => {
    const grid = document.querySelector("[data-library-overview-grid]");
    return grid instanceof HTMLElement
      && getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length === 1;
  })()`, { timeoutMs: 60_000, label: "single-column overview on a phone" });

  const mobileTitles = await cardTitles(browser);
  evidence.fact
  (
    "The phone layout keeps one column and the same order",
    "At 375px the grid collapses to a single column with the cards still ordered Connections, Models, Skills, Plugins.",
    mobileTitles === "connections,models,skills,plugins",
  );
  expect(mobileTitles).toBe("connections,models,skills,plugins");

  const mobileShot = await screenshot(browser);
  const mobileSeen = await validate(mobileShot, [
    "A narrow mobile layout stacks the library cards in a single column",
  ]);
  expect(mobileSeen.ok, mobileSeen.why).toBe(true);
});
