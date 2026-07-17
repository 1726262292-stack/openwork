import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";
import { signInApi } from "./lib/den-web.mjs";

const FLOW_ID = "desktop-policy-reload-persistence";
const vo = await loadVoiceoverParagraphs(FLOW_ID);

const POLICY_BANNER_SELECTOR = '[data-testid="desktop-policy-banner"]';
const CLICK_ANY = "button, [role=button], a, div, article, li, label";
const WORKSPACE_PATH = process.env.OPENWORK_EVAL_WORKSPACE_PATH?.trim() || "/tmp/openwork-desktop-policy-reload-persistence";

const DEFAULT_POLICY = {
  allowCustomProviders: true,
  allowZenModel: true,
  allowMultipleWorkspaces: true,
  allowControlSettings: true,
  allowManageExtensions: true,
  allowBuiltInExtensions: true,
  showWelcomePage: true,
};

const RESTRICTED_POLICY = {
  ...DEFAULT_POLICY,
  allowCustomProviders: false,
  allowZenModel: false,
};

export default {
  id: FLOW_ID,
  kind: "user-facing",
  title: "Org model restrictions apply from the app's own boot fetch and persist across reload",
  spec: "evals/desktop-policy-extension-flows.md",
  requiredEnv: [
    "OPENWORK_EVAL_DEN_API_URL",
    "OPENWORK_EVAL_OWNER_EMAIL",
    "OPENWORK_EVAL_OWNER_PASSWORD",
  ],
  steps: [
    {
      name: "App booted and signed in",
      run: async (ctx) => {
        await ctx.waitFor("Boolean(window.__openworkControl)", {
          timeoutMs: 60_000,
          label: "window.__openworkControl",
        });
        const status = await ensureDesktopSignedInAsOwner(ctx);
        ctx.recordEvidence({
          type: "assertion",
          status: "passed",
          assertion: `Desktop cloud account is signed in as ${status.user?.email ?? ctx.env.OPENWORK_EVAL_OWNER_EMAIL}.`,
        });
      },
    },
    {
      name: "Reset policies to defaults",
      run: async (ctx) => {
        await ctx.prove("Default desktop policies show no organization policy banner", {
          voiceover: vo[0],
          action: async () => {
            const ownerToken = await freshOwnerToken(ctx);
            await patchDefaultDesktopPolicy(ctx, ownerToken, DEFAULT_POLICY);
            await clearDesktopConfigCache(ctx);
            await reloadAndWaitForControl(ctx);
            await openSettingsPanel(ctx, "general");
            await waitForPolicyBannerAbsent(ctx);
          },
          assert: async () => {
            await ctx.expectNoText("Organization policies active");
          },
          screenshot: {
            name: "default-policy-no-banner",
            claim: "With every desktop policy restored to default, Settings has no organization policy banner.",
            rejectText: ["Organization policies active", "Something went wrong"],
            hashIncludes: "/settings",
          },
        });
      },
    },
    {
      name: "Admin restricts custom providers and the Zen model",
      run: async (ctx) => {
        const ownerToken = await freshOwnerToken(ctx);
        await patchDefaultDesktopPolicy(ctx, ownerToken, RESTRICTED_POLICY);
        const config = await denRequest(ctx, ownerToken, "/v1/me/desktop-config");
        ctx.assert(config?.allowCustomProviders === false, "Server desktop config did not disable custom providers.");
        ctx.assert(config?.allowZenModel === false, "Server desktop config did not disable the Zen model.");
        ctx.recordEvidence({
          type: "assertion",
          status: "passed",
          assertion: "/v1/me/desktop-config reports allowCustomProviders=false and allowZenModel=false for the signed-in owner.",
        });
      },
    },
    {
      name: "Restriction lands after reload from the app's own fetch",
      run: async (ctx) => {
        await ctx.prove("The app fetches the restriction on boot and shows the policy banner", {
          voiceover: vo[1],
          action: async () => {
            await clearDesktopConfigCache(ctx);
            await reloadAndWaitForControl(ctx);
            await openSettingsPanel(ctx, "general");
            await waitForPolicyBannerPresent(ctx);
          },
          assert: async () => {
            await ctx.expectText("Organization policies active", { timeoutMs: 20_000 });
          },
          screenshot: {
            name: "banner-after-boot-fetch",
            claim: "After clearing the desktop-config cache and reloading, the Settings banner appears from the app's own boot fetch.",
            requireText: ["Organization policies active"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings",
          },
        });
      },
    },
    {
      name: "Model restriction is enforced in the UI",
      run: async (ctx) => {
        await ctx.prove("The AI settings UI blocks adding custom providers", {
          voiceover: vo[2],
          action: async () => {
            await openSettingsPanel(ctx, "ai");
            await clickExactText(ctx, "Connect provider", "button", 30_000);
            await ctx.waitForText("Adding custom providers is disabled", { timeoutMs: 20_000 });
          },
          assert: async () => {
            await ctx.expectText("Adding custom providers is disabled", { timeoutMs: 20_000 });
          },
          screenshot: {
            name: "custom-provider-restricted-modal",
            claim: "Clicking Connect provider opens the organization restriction notice instead of the provider setup modal.",
            requireText: ["Adding custom providers is disabled"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/ai",
          },
        });
        await clickExactText(ctx, "Close", "button", 20_000).catch(() => {});
      },
    },
    {
      name: "Restriction persists across a second reload",
      run: async (ctx) => {
        await ctx.prove("The restriction remains active after a second reload", {
          voiceover: vo[3],
          action: async () => {
            await reloadAndWaitForControl(ctx);
            await openSettingsPanel(ctx, "ai");
            await waitForPolicyBannerPresent(ctx);
          },
          assert: async () => {
            await ctx.expectText("Organization policies active", { timeoutMs: 20_000 });
          },
          screenshot: {
            name: "banner-persists-second-reload",
            claim: "A second reload still shows the organization policy banner on another Settings tab.",
            requireText: ["Organization policies active"],
            rejectText: ["Something went wrong"],
            hashIncludes: "/settings/ai",
          },
        });
      },
    },
    {
      name: "Admin restores; the app returns to default after reload",
      run: async (ctx) => {
        await ctx.prove("Restoring defaults removes the banner after reload", {
          voiceover: vo[4],
          action: async () => {
            const ownerToken = await freshOwnerToken(ctx);
            await patchDefaultDesktopPolicy(ctx, ownerToken, DEFAULT_POLICY);
            await clearDesktopConfigCache(ctx);
            await reloadAndWaitForControl(ctx);
            await openSettingsPanel(ctx, "general");
            await waitForPolicyBannerAbsent(ctx);
          },
          assert: async () => {
            await ctx.expectNoText("Organization policies active");
          },
          screenshot: {
            name: "banner-gone-after-restore",
            claim: "After the admin restores defaults and the app reloads, Settings returns to the unrestricted state.",
            rejectText: ["Organization policies active", "Something went wrong"],
            hashIncludes: "/settings",
          },
        });
      },
    },
  ],
};

async function freshOwnerToken(ctx) {
  const token = await signInApi(
    ctx.env.OPENWORK_EVAL_OWNER_EMAIL.trim(),
    ctx.env.OPENWORK_EVAL_OWNER_PASSWORD.trim(),
  );
  ctx.assert(typeof token === "string" && token.trim().length > 0, "Could not mint a fresh owner token.");
  const trimmed = token.trim();
  await ensureAcmeActiveOrg(ctx, trimmed);
  return trimmed;
}

async function denRequest(ctx, token, path, init = {}) {
  const apiBase = ctx.env.OPENWORK_EVAL_DEN_API_URL.trim().replace(/\/+$/, "");
  const { allowStatuses = [], headers = {}, ...fetchInit } = init;
  const response = await fetch(`${apiBase}${path}`, {
    ...fetchInit,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers,
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  ctx.assert(
    response.ok || allowStatuses.includes(response.status),
    `${fetchInit.method ?? "GET"} ${path} failed: ${response.status} ${text.slice(0, 300)}`,
  );
  return body;
}

async function ensureAcmeActiveOrg(ctx, token) {
  const listed = await denRequest(ctx, token, "/v1/me/orgs");
  const orgs = Array.isArray(listed?.orgs) ? listed.orgs : [];
  const acme = orgs.find((org) => org?.name === "Acme Robotics")
    ?? orgs.find((org) => typeof org?.slug === "string" && org.slug.includes("acme"))
    ?? orgs[0];
  ctx.assert(acme && typeof acme.id === "string", "Could not find Acme Robotics for the owner account.");
  if (listed?.activeOrgId !== acme.id) {
    await denRequest(ctx, token, "/v1/me/active-organization", {
      method: "POST",
      body: JSON.stringify({ organizationId: acme.id }),
    });
  }
  return acme;
}

async function patchDefaultDesktopPolicy(ctx, token, policy) {
  const listed = await denRequest(ctx, token, "/v1/desktop-policies");
  const policies = Array.isArray(listed?.desktopPolicies) ? listed.desktopPolicies : [];
  const defaultPolicy = policies.find((item) => item?.isDefault === true);
  ctx.assert(defaultPolicy && typeof defaultPolicy.id === "string", "Default desktop policy was not returned by /v1/desktop-policies.");

  await denRequest(ctx, token, `/v1/desktop-policies/${encodeURIComponent(defaultPolicy.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      policyName: defaultPolicy.policyName,
      policy,
    }),
  });
}

async function ensureDesktopSignedInAsOwner(ctx) {
  const ownerEmail = ctx.env.OPENWORK_EVAL_OWNER_EMAIL.trim().toLowerCase();
  const status = await currentAuthStatus(ctx);
  const currentEmail = typeof status.user?.email === "string" ? status.user.email.trim().toLowerCase() : "";
  if (status.status === "signed_in" && currentEmail === ownerEmail) return status;

  if (status.status === "signed_in") await signOutDesktopCloud(ctx);

  const ownerToken = await freshOwnerToken(ctx);
  await signInDesktopWithHandoff(ctx, ownerToken);
  await completeDesktopCloudOnboardingIfNeeded(ctx);
  await openSettingsPanel(ctx, "general");
  const nextStatus = await currentAuthStatus(ctx);
  ctx.assert(nextStatus.status === "signed_in", `Expected signed_in after owner handoff, got ${nextStatus.status}.`);
  return nextStatus;
}

async function currentAuthStatus(ctx) {
  const status = await ctx.control("auth.status").catch(async () => {
    const signedIn = await ctx.eval("Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())");
    return { status: signedIn ? "signed_in" : "signed_out", user: null };
  });
  return status ?? { status: "signed_out", user: null };
}

async function signOutDesktopCloud(ctx) {
  await openSettingsPanel(ctx, "cloud-account");
  await clickExactText(ctx, "Sign out", "button", 30_000);
  await ctx.waitForText("Paste sign-in code", { timeoutMs: 60_000 });
  await ctx.waitFor("!Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())", {
    timeoutMs: 30_000,
    label: "desktop cloud token cleared",
  });
}

async function signInDesktopWithHandoff(ctx, token) {
  const handoff = await denRequest(ctx, token, "/v1/auth/desktop-handoff", {
    method: "POST",
    body: JSON.stringify({ desktopScheme: "openwork" }),
  });
  ctx.assert(typeof handoff?.openworkUrl === "string" && handoff.openworkUrl.length > 0, "Desktop handoff returned no openworkUrl.");

  await openSettingsPanel(ctx, "cloud-account");
  await ctx.clickText("Paste sign-in code", { timeoutMs: 30_000 });
  await ctx.fill("#den-signin-link", handoff.openworkUrl);
  await ctx.clickText("Finish sign-in", { timeoutMs: 30_000 });
  await ctx.waitFor("Boolean((localStorage.getItem('openwork.den.authToken') ?? '').trim())", {
    timeoutMs: 60_000,
    label: "persisted Den auth token",
  });
}

async function completeDesktopCloudOnboardingIfNeeded(ctx) {
  await ctx.waitForText("Choose your organization", { timeoutMs: 10_000 }).then(async () => {
    await clickSmallestContaining(ctx, "Acme Robotics", CLICK_ANY, 20_000);
    await clickExactText(ctx, "Continue with organization", "button", 20_000);
  }).catch(() => {});

  await clickExactText(ctx, "Continue to workspace", "button", 30_000).catch(() => {});

  const needsFolder = await ctx.eval("Boolean(document.querySelector('input[placeholder=\"/workspace/my-project\"]'))").catch(() => false);
  if (needsFolder) {
    await ctx.fill('input[placeholder="/workspace/my-project"]', WORKSPACE_PATH);
    await clickExactText(ctx, "Use this folder", "button", 20_000);
  }

  await clickExactText(ctx, "Continue without OpenWork Models", "button", 5_000).catch(() => {});
  await clickExactText(ctx, "Skip and use the free model", "button", 5_000).catch(() => {});
  await clickExactText(ctx, "Skip", "button", 5_000).catch(() => {});

  const inSettings = await ctx.eval("window.location.hash.includes('/settings')").catch(() => false);
  if (!inSettings) await openSettingsPanel(ctx, "general");
}

async function openSettingsPanel(ctx, panel) {
  await ctx.control("settings.panel.open", { panel }).catch(async () => {
    await ctx.navigateHash(`/settings/${panel}`);
  });
  await ctx.waitFor(`window.location.hash.includes('/settings/${panel}')`, {
    timeoutMs: 30_000,
    label: `${panel} settings route`,
  });
}

async function reloadAndWaitForControl(ctx) {
  await ctx.eval("location.reload()");
  await ctx.waitFor("Boolean(window.__openworkControl)", {
    timeoutMs: 60_000,
    label: "control API after reload",
  });
}

async function clearDesktopConfigCache(ctx) {
  await ctx.eval(`(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('openwork.den.desktopConfig:')) localStorage.removeItem(key);
    }
    return true;
  })()`);
}

async function waitForPolicyBannerPresent(ctx) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(POLICY_BANNER_SELECTOR)}))`, {
    timeoutMs: 20_000,
    label: "desktop policy banner present",
  });
  await ctx.waitForText("Organization policies active", { timeoutMs: 20_000 });
}

async function waitForPolicyBannerAbsent(ctx) {
  await ctx.waitFor(`!document.querySelector(${JSON.stringify(POLICY_BANNER_SELECTOR)})`, {
    timeoutMs: 20_000,
    label: "desktop policy banner absent",
  });
}

async function clickSmallestContaining(ctx, text, selector, timeoutMs) {
  await ctx.waitFor(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((element) => {
        const label = (element.innerText ?? element.textContent ?? '').replace(/\\s+/g, ' ').trim();
        return label.includes(${JSON.stringify(text)}) && !element.disabled;
      })
      .sort((left, right) => (left.innerText ?? left.textContent ?? '').length - (right.innerText ?? right.textContent ?? '').length);
    const element = candidates[0];
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs, label: `click smallest element containing ${text}` });
}

async function clickExactText(ctx, text, selector, timeoutMs) {
  await ctx.waitFor(`(() => {
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((element) => (element.innerText ?? element.textContent ?? '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)} && !element.disabled);
    const element = candidates[candidates.length - 1];
    element?.scrollIntoView({ block: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs, label: `click exact text ${text}` });
}
