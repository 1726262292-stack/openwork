import sharp from "sharp";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("den-sidebar-brand-icon");
const DEN_API_URL = (process.env.OPENWORK_EVAL_DEN_API_URL ?? "").trim().replace(/\/+$/, "");
const DEN_WEB_URL = (process.env.OPENWORK_EVAL_DEN_WEB_URL ?? "").trim().replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.OPENWORK_EVAL_DEMO_EMAIL?.trim() || "alex@acme.test";
const ADMIN_PASSWORD = process.env.OPENWORK_EVAL_DEMO_PASSWORD?.trim() || "OpenWorkDemo123!";
const state = { token: null, iconUrl: null };

async function apiRequest(path, options = {}) {
  const response = await fetch(`${DEN_API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      authorization: `Bearer ${state.token}`,
      origin: DEN_WEB_URL,
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  return { response, body };
}

async function signInApi(ctx) {
  const response = await fetch(`${DEN_API_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: DEN_WEB_URL },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = await response.json();
  ctx.assert(response.ok && typeof body.token === "string", `API sign-in failed: ${response.status} ${JSON.stringify(body)}`);
  state.token = body.token;
}

async function uploadManagedIcon(ctx) {
  const png = await sharp({
    create: { width: 128, height: 128, channels: 4, background: "#0f766e" },
  })
    .composite([
      {
        input: Buffer.from('<svg width="128" height="128"><circle cx="64" cy="64" r="38" fill="#ccfbf1"/><path d="M43 65l14 14 30-34" fill="none" stroke="#0f766e" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>'),
      },
    ])
    .png()
    .toBuffer();
  const form = new FormData();
  form.set("icon", new Blob([png], { type: "image/png" }), "den-sidebar-icon.png");
  const { response, body } = await apiRequest("/v1/org/brand-assets", { method: "POST", body: form });
  ctx.assert(response.ok, `Managed icon upload failed: ${response.status} ${JSON.stringify(body)}`);
  state.iconUrl = body.assets?.icon?.url ?? null;
  ctx.assert(typeof state.iconUrl === "string", `Upload did not return a managed icon: ${JSON.stringify(body)}`);
}

async function clearManagedIcon(ctx) {
  const { response, body } = await apiRequest("/v1/org", {
    method: "PATCH",
    body: JSON.stringify({ brandIconUrl: null }),
  });
  ctx.assert(response.ok, `Clearing the managed icon failed: ${response.status} ${JSON.stringify(body)}`);
}

async function enterDashboard(ctx) {
  await ctx.eval(`location.assign(${JSON.stringify(DEN_WEB_URL)})`);
  await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 30_000, label: "Den web loaded" });
  await ctx.eval(
    `fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(() => true).catch(() => true)`,
    { awaitPromise: true },
  );
  await ctx.eval(`location.assign(${JSON.stringify(DEN_WEB_URL)})`);
  await ctx.waitFor('Boolean(document.querySelector(\'input[type="email"]\'))', { timeoutMs: 30_000, label: "sign-in form" });
  await ctx.eval(`(() => {
    const tab = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === 'Sign in');
    tab?.click();
    return true;
  })()`);
  await ctx.fill('input[type="email"]', ADMIN_EMAIL);
  await ctx.fill('input[type="password"]', ADMIN_PASSWORD);
  await ctx.eval(`(() => { document.querySelector('button[type="submit"]')?.click(); return true; })()`);
  await ctx.waitFor(`(() => {
    const text = document.body?.innerText ?? '';
    if (document.querySelector('nav') && !text.includes('Choose an organization')) return true;
    if (!text.includes('Choose an organization')) return false;
    const org = [...document.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes('member'));
    org?.click();
    return false;
  })()`, { timeoutMs: 60_000, label: "dashboard sidebar" });
}

async function reloadDashboard(ctx) {
  await ctx.eval("location.reload()").catch(() => undefined);
}

async function iconState(ctx) {
  return ctx.eval(`(() => {
    const mark = document.querySelector('[data-sidebar-brand-icon]');
    const image = mark?.querySelector('img');
    return {
      state: mark?.getAttribute('data-sidebar-brand-icon') ?? null,
      hasImage: Boolean(image),
      hasSvg: Boolean(mark?.querySelector('svg')),
      src: image?.getAttribute('src') ?? null,
      naturalWidth: image?.naturalWidth ?? 0,
    };
  })()`);
}

export default {
  id: "den-sidebar-brand-icon",
  title: "Den uses the managed organization square icon in its sidebar without flashes or broken images",
  kind: "user-facing",
  requiredEnv: ["OPENWORK_EVAL_DEN_API_URL", "OPENWORK_EVAL_DEN_WEB_URL"],
  steps: [
    {
      name: "Setup",
      run: async (ctx) => {
        await signInApi(ctx);
        await clearManagedIcon(ctx);
        await uploadManagedIcon(ctx);
        await enterDashboard(ctx);
      },
    },
    {
      name: "Frame 1",
      run: async (ctx) => {
        await ctx.prove("The sidebar holds a neutral square while organization branding loads", {
          voiceover: vo[0],
          action: async () => {
            await ctx.client.send("Network.enable");
            await ctx.client.send("Network.emulateNetworkConditions", {
              offline: false,
              latency: 2_500,
              downloadThroughput: -1,
              uploadThroughput: -1,
              connectionType: "wifi",
            });
            await reloadDashboard(ctx);
            await ctx.waitFor(`document.querySelector('[data-sidebar-brand-icon="loading"]') && !document.querySelector('[data-sidebar-brand-icon] img')`, {
              timeoutMs: 30_000,
              label: "neutral sidebar icon placeholder",
            });
          },
          assert: async () => {
            const icon = await iconState(ctx);
            ctx.assert(icon.state === "loading", `Expected loading placeholder: ${JSON.stringify(icon)}`);
            ctx.assert(!icon.hasImage && !icon.hasSvg, `Loading state flashed an image or SVG: ${JSON.stringify(icon)}`);
          },
          screenshot: {
            name: "sidebar-branding-loading",
            claim: "The Den sidebar reserves a neutral square while organization branding loads.",
            requireText: ["Dashboard"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 2",
      run: async (ctx) => {
        await ctx.prove("The sidebar replaces the generic OpenWork mark with the managed organization icon", {
          voiceover: vo[1],
          action: async () => {
            await ctx.client.send("Network.emulateNetworkConditions", {
              offline: false,
              latency: 0,
              downloadThroughput: -1,
              uploadThroughput: -1,
              connectionType: "wifi",
            });
            await ctx.waitFor(`document.querySelector('[data-sidebar-brand-icon="ready"]')`, { timeoutMs: 30_000, label: "managed sidebar icon" });
          },
          assert: async () => {
            const icon = await iconState(ctx);
            ctx.assert(icon.state === "ready" && icon.hasImage && !icon.hasSvg, `Managed icon was not ready: ${JSON.stringify(icon)}`);
            ctx.assert(icon.naturalWidth === 128, `Managed icon did not decode at 128px: ${JSON.stringify(icon)}`);
            ctx.assert(icon.src === state.iconUrl, `Sidebar used ${icon.src} instead of ${state.iconUrl}`);
          },
          screenshot: {
            name: "sidebar-managed-brand-icon",
            claim: "The Den sidebar visibly shows the organization's managed square icon instead of the OpenWork SVG.",
            requireText: ["Dashboard"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 3",
      run: async (ctx) => {
        await ctx.prove("An organization without a managed icon gets the intact OpenWork fallback", {
          voiceover: vo[2],
          action: async () => {
            await clearManagedIcon(ctx);
            await reloadDashboard(ctx);
            await ctx.waitFor(`document.querySelector('[data-sidebar-brand-icon="fallback"]')`, { timeoutMs: 30_000, label: "sidebar fallback" });
          },
          assert: async () => {
            const icon = await iconState(ctx);
            ctx.assert(icon.state === "fallback" && icon.hasSvg && !icon.hasImage, `Fallback was not intact: ${JSON.stringify(icon)}`);
          },
          screenshot: {
            name: "sidebar-brand-icon-fallback",
            claim: "Without a custom square icon, Den shows the intact OpenWork fallback and no broken image.",
            requireText: ["Dashboard"],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Frame 4",
      run: async (ctx) => {
        await ctx.prove("Brand upload controls and desktop delivery remain intact while the sidebar consumes the same managed icon", {
          voiceover: vo[3],
          action: async () => {
            await uploadManagedIcon(ctx);
            await reloadDashboard(ctx);
            await ctx.waitFor(`document.querySelector('[data-sidebar-brand-icon="ready"]')`, { timeoutMs: 30_000, label: "restored managed sidebar icon" });
            await ctx.clickText("Settings", { timeoutMs: 15_000 });
            await ctx.waitForText("Brand Appearance", { timeoutMs: 30_000 });
            await ctx.eval(`(() => {
              const heading = [...document.querySelectorAll('h2')].find((node) => node.textContent?.trim() === 'Brand Appearance');
              heading?.scrollIntoView({ block: 'start' });
              return Boolean(heading);
            })()`);
          },
          assert: async () => {
            await ctx.expectText("Square app icon");
            await ctx.expectText("Stored in this Den");
            const config = await apiRequest("/v1/me/desktop-config");
            ctx.assert(config.response.ok && config.body.brandIconUrl === state.iconUrl, `Desktop config did not retain the managed icon: ${JSON.stringify(config.body)}`);
            const icon = await iconState(ctx);
            ctx.assert(icon.state === "ready" && icon.src === state.iconUrl, `Sidebar did not retain the managed icon: ${JSON.stringify(icon)}`);
          },
          screenshot: {
            name: "brand-controls-and-sidebar-icon",
            claim: "Brand Appearance still shows the managed square-icon controls while the sidebar uses that icon.",
            requireText: ["Brand Appearance", "Square app icon", "Stored in this Den"],
            rejectText: ["Something went wrong", "No custom image saved"],
          },
        });
      },
    },
  ],
};
