import type { Surface } from "@openwork/cdp";
import { evalIn, waitFor } from "./desktop.ts";

const PLUG_BUTTON = 'button[title="Commands, skills, and MCPs"]';
const SKILL_MARKERS = ["/browser-automation", "/agent-first-screenshots"];

export interface SkillFacts {
  name: string;
  label: string;
  local: boolean;
}

export interface SkillsLoadFacts {
  elapsedMs: number;
  rowCount: number;
  skills: SkillFacts[];
  loadingCommandsVisible: boolean;
}

export interface ComposerCapabilitiesFacts {
  sections: string[];
}

export interface SlowCloudSkillsFacts extends SkillsLoadFacts {
  denRequestCount: number;
  connectSettledMs: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSkills(value: unknown): SkillFacts[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.label !== "string") return [];
    return [{ name: entry.name, label: entry.label, local: entry.local === true }];
  });
}

function parseSkillsLoad(value: unknown): SkillsLoadFacts {
  if (!isRecord(value)) throw new Error(`Skills load returned malformed facts: ${JSON.stringify(value)}`);
  return {
    elapsedMs: typeof value.elapsedMs === "number" ? value.elapsedMs : Number.POSITIVE_INFINITY,
    rowCount: typeof value.rowCount === "number" ? value.rowCount : 0,
    skills: parseSkills(value.skills),
    loadingCommandsVisible: value.loadingCommandsVisible === true,
  };
}

async function openPlugMenu(app: Surface): Promise<void> {
  await evalIn(app, `(() => {
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    return true;
  })()`);
  await waitFor(app, `Boolean(document.querySelector(${JSON.stringify(PLUG_BUTTON)}))`, {
    timeoutMs: 60_000,
    label: "composer plug button",
  });
  await evalIn(app, `document.querySelector(${JSON.stringify(PLUG_BUTTON)}).click()`);
  await waitFor(app, `(() => {
    const labels = [...document.querySelectorAll("button")].map((button) => (button.textContent ?? "").trim());
    return labels.includes("Skills") && labels.includes("Extensions");
  })()`, { label: "plug menu sections" });
}

export async function readComposerCapabilities(app: Surface): Promise<ComposerCapabilitiesFacts> {
  await openPlugMenu(app);
  const value = await evalIn(app, `(() => {
    const labels = [...document.querySelectorAll("button")].map((button) => (button.textContent ?? "").trim());
    return ["Agents", "Commands", "Skills", "Extensions"].filter((section) => labels.includes(section));
  })()`);
  return { sections: Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [] };
}

export async function measureLoadedSkills(app: Surface): Promise<SkillsLoadFacts> {
  await openPlugMenu(app);
  const value = await evalIn(app, `new Promise((resolve) => {
    const skillsButton = [...document.querySelectorAll("button")]
      .find((button) => (button.textContent ?? "").trim() === "Skills");
    if (!skillsButton) { resolve({ error: "skills section button not found" }); return; }
    const startedAt = performance.now();
    skillsButton.click();
    const poll = () => {
      const rows = [...document.querySelectorAll("button")]
        .filter((button) => /^\\/[a-z0-9-]+/i.test((button.textContent ?? "").trim()));
      const hit = rows.some((button) => ${JSON.stringify(SKILL_MARKERS)}
        .some((marker) => (button.textContent ?? "").includes(marker)));
      if (hit) {
        resolve({
          elapsedMs: Math.round(performance.now() - startedAt),
          rowCount: rows.length,
          skills: rows.map((button) => {
            const label = (button.textContent ?? "").replace(/\\s+/g, " ").trim();
            return { name: label.split(/\\s+/)[0], label, local: label.includes("Local") };
          }),
          loadingCommandsVisible: document.body.innerText.includes("Loading commands"),
        });
        return;
      }
      if (performance.now() - startedAt > 20_000) {
        resolve({ error: "timed out", bodyTail: document.body.innerText.slice(-400) });
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  })`, { awaitPromise: true });
  if (isRecord(value) && typeof value.error === "string") throw new Error(`Skills did not render: ${JSON.stringify(value)}`);
  return parseSkillsLoad(value);
}

export async function readLoadedSkills(app: Surface): Promise<SkillFacts[]> {
  return (await measureLoadedSkills(app)).skills;
}

export async function readLoadedExtensions(app: Surface): Promise<string[]> {
  await openPlugMenu(app);
  await waitFor(app, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => (candidate.textContent ?? "").trim() === "Extensions");
    if (!button) return false;
    button.click();
    return true;
  })()`, { label: "Extensions section" });
  await waitFor(app, 'document.body.innerText.includes("OpenWork Browser")', {
    timeoutMs: 10_000,
    label: "OpenWork Browser extension",
  });
  const value = await evalIn(app, `([...document.querySelectorAll("button")]
    .map((button) => (button.textContent ?? "").replace(/\\s+/g, " ").trim())
    .filter((label) => label.includes("OpenWork Browser")))`);
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export async function measureSkillsWithSlowCloud(app: Surface): Promise<SlowCloudSkillsFacts> {
  await evalIn(app, "location.reload()");
  await waitFor(app, "Boolean(window.__openworkControl)", { timeoutMs: 60_000, label: "control API after slow-cloud reload" });
  await waitFor(app, `Boolean(document.querySelector(${JSON.stringify(PLUG_BUTTON)}))`, {
    timeoutMs: 60_000,
    label: "composer plug button after slow-cloud reload",
  });
  const value = await evalIn(app, `new Promise((resolve) => {
    window.__OPENWORK_GATEWAY__ = { version: 1 };
    const originalFetch = window.fetch.bind(window);
    window.__denFetchLog = [];
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : (input?.url || String(input));
      if (String(url).includes("marketplace-capabilities")) {
        window.__denFetchLog.push({ url: String(url).slice(0, 120), at: Math.round(performance.now()) });
        await new Promise((done) => setTimeout(done, 15_000));
      }
      return originalFetch(input, init);
    };
    localStorage.setItem("openwork.den.authToken", "eval-slow-cloud-token");
    localStorage.setItem("openwork.den.activeOrgId", "org_slowcloud_" + Date.now());
    import("/src/react-app/domains/connections/cloud-inventory-cache.ts").then((module) => {
      const connectStartedAt = performance.now();
      const witness = { connectSettledMs: null };
      module.loadSessionConnectCapabilities().then(() => {
        witness.connectSettledMs = Math.round(performance.now() - connectStartedAt);
      });
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      setTimeout(() => {
        document.querySelector(${JSON.stringify(PLUG_BUTTON)})?.click();
        setTimeout(() => {
          const skillsButton = [...document.querySelectorAll("button")]
            .find((button) => (button.textContent ?? "").trim() === "Skills");
          if (!skillsButton) { resolve({ error: "skills section button not found" }); return; }
          const startedAt = performance.now();
          skillsButton.click();
          const poll = () => {
            const rows = [...document.querySelectorAll("button")]
              .filter((button) => /^\\/[a-z0-9-]+/i.test((button.textContent ?? "").trim()));
            const hit = rows.some((button) => ${JSON.stringify(SKILL_MARKERS)}
              .some((marker) => (button.textContent ?? "").includes(marker)));
            if (hit) {
              const elapsedMs = Math.round(performance.now() - startedAt);
              setTimeout(() => resolve({
                elapsedMs,
                rowCount: rows.length,
                skills: rows.map((button) => {
                  const label = (button.textContent ?? "").replace(/\\s+/g, " ").trim();
                  return { name: label.split(/\\s+/)[0], label, local: label.includes("Local") };
                }),
                loadingCommandsVisible: document.body.innerText.includes("Loading commands"),
                denRequestCount: window.__denFetchLog.length,
                connectSettledMs: witness.connectSettledMs,
              }), 1_500);
              return;
            }
            if (performance.now() - startedAt > 20_000) {
              resolve({ error: "timed out", denRequestCount: window.__denFetchLog.length });
              return;
            }
            setTimeout(poll, 20);
          };
          poll();
        }, 300);
      }, 100);
    }).catch((error) => resolve({ error: String(error).slice(0, 200) }));
  })`, { awaitPromise: true });
  if (!isRecord(value) || typeof value.error === "string") throw new Error(`Slow-cloud skills scenario failed: ${JSON.stringify(value)}`);
  return {
    ...parseSkillsLoad(value),
    denRequestCount: typeof value.denRequestCount === "number" ? value.denRequestCount : 0,
    connectSettledMs: typeof value.connectSettledMs === "number" ? value.connectSettledMs : null,
  };
}

export async function resetSkillsCloudState(app: Surface): Promise<void> {
  await evalIn(app, `(() => {
    localStorage.removeItem("openwork.den.authToken");
    localStorage.removeItem("openwork.den.activeOrgId");
    localStorage.removeItem("openwork.den.activeOrgSlug");
    localStorage.removeItem("openwork.den.activeOrgName");
    delete window.__OPENWORK_GATEWAY__;
    location.reload();
    return true;
  })()`);
  await waitFor(app, "Boolean(window.__openworkControl)", { timeoutMs: 60_000, label: "control API after skills cleanup" });
}
