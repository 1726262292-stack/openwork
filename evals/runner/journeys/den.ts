import { execSync } from "node:child_process";
import { EvalError } from "../context.ts";
import type { Actor } from "../actors.ts";
import type { FlowContext } from "../flow.ts";
import type { Surface } from "../surfaces.ts";

export interface DenUrlOptions {
  denApiUrl?: string;
  denWebUrl?: string;
}

export interface DenUrls {
  apiUrl: string;
  webUrl: string;
}

export interface SignInWebOptions {
  surface: string | Surface;
  actor: Actor;
}

export interface ApiSignInOptions extends DenUrlOptions {
  actor: Actor;
}

export interface CreateOrgOptions {
  surface: string | Surface;
  actor: Actor;
  name: string;
  slug?: string;
}

export interface CreateOrgResult {
  orgId?: string;
  slug: string;
  name: string;
  path: "api+ui-verify";
}

export interface InviteMemberOptions {
  surface?: string | Surface;
  actor: Actor;
  email: string;
  role?: string;
}

export interface InviteRef {
  inviteUrl?: string;
  token?: string;
  email?: string;
  invitationId?: string;
}

export interface InviteMemberResult extends InviteRef {
  email: string;
  path: "ui" | "api";
}

export interface AcceptInviteOptions {
  surface: string | Surface;
  actor: Actor;
  invite: InviteRef;
}

export interface AcceptInviteResult {
  email: string;
  inviteUrl: string;
  status: "accepted";
}

export interface DenApiFetchResult {
  response: Response;
  body: unknown;
  text: string;
}

interface BrowserOrganization {
  id: string;
  name: string;
  slug: string;
}

const AUTH_TOKEN_STORAGE_KEY = "openwork:web:auth-token";
const DEFAULT_INVITE_ROLE = "member";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActorRole(value: unknown): value is Actor["role"] {
  return value === "owner" || value === "member" || value === "fresh";
}

function messageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonText(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function cleanBaseUrlRequired(value: string | undefined, envName: string): string {
  const cleaned = cleanBaseUrl(value);
  if (!cleaned) throw new EvalError(`${envName} is required for Den journeys.`);
  return cleaned;
}

function authHeaders(token: string): Headers {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${token}`);
  return headers;
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function slugFromName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "organization";
}

function organizationFromPayload(body: unknown, fallbackName: string, fallbackSlug?: string): BrowserOrganization {
  const organization = isRecord(body) && isRecord(body.organization) ? body.organization : null;
  if (!organization) {
    throw new EvalError(`Organization response did not include an organization object: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const id = stringField(organization, "id");
  const name = stringField(organization, "name") || fallbackName;
  const slug = stringField(organization, "slug") || fallbackSlug?.trim() || slugFromName(name);
  return { id, name, slug };
}

function findInviteString(value: unknown, keys: Set<string>, depth: number): string {
  if (depth > 8) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.includes("/join-org?invite=") ? trimmed : "";
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findInviteString(entry, keys, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (!isRecord(value)) return "";
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key) && typeof entry === "string" && entry.trim()) return entry.trim();
  }
  for (const entry of Object.values(value)) {
    const found = findInviteString(entry, keys, depth + 1);
    if (found) return found;
  }
  return "";
}

function findTokenString(value: unknown, keys: Set<string>, depth: number): string {
  if (depth > 8) return "";
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findTokenString(entry, keys, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (!isRecord(value)) return "";
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key) && typeof entry === "string" && entry.trim()) return entry.trim();
  }
  for (const entry of Object.values(value)) {
    const found = findTokenString(entry, keys, depth + 1);
    if (found) return found;
  }
  return "";
}

function invitationIdFromBody(body: unknown): string {
  if (!isRecord(body)) return "";
  return stringField(body, "invitationId") || stringField(body, "id");
}

function pendingInviteFromOrgBody(body: unknown, email: string): InviteRef {
  if (!isRecord(body) || !Array.isArray(body.invitations)) return {};
  const targetEmail = normalizedEmail(email);
  for (const entry of body.invitations) {
    if (!isRecord(entry)) continue;
    const candidateEmail = normalizedEmail(stringField(entry, "email"));
    const status = stringField(entry, "status");
    const token = stringField(entry, "inviteToken");
    if (candidateEmail === targetEmail && status === "pending" && token) {
      return {
        token,
        invitationId: stringField(entry, "id") || stringField(entry, "invitationId"),
      };
    }
  }
  return {};
}

function webFetchBase(path: string, urls: DenUrls): string {
  // Provenance: evals/flows/lib/den-web.mjs:13-24 routes Better Auth
  // requests through den-web so the proxy can supply a trusted Origin.
  return path.startsWith("/api/auth/") && urls.webUrl ? urls.webUrl : urls.apiUrl;
}

export function cleanBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

export function resolveDenApiUrl(env: NodeJS.ProcessEnv, override?: string): string {
  return cleanBaseUrlRequired(override ?? env.OPENWORK_EVAL_DEN_API_URL, "OPENWORK_EVAL_DEN_API_URL");
}

export function resolveDenWebUrl(env: NodeJS.ProcessEnv, override?: string): string {
  return cleanBaseUrlRequired(override ?? env.OPENWORK_EVAL_DEN_WEB_URL, "OPENWORK_EVAL_DEN_WEB_URL");
}

export function resolveDenUrls(env: NodeJS.ProcessEnv, options: DenUrlOptions = {}): DenUrls {
  return {
    apiUrl: resolveDenApiUrl(env, options.denApiUrl),
    webUrl: resolveDenWebUrl(env, options.denWebUrl),
  };
}

export function denApiUrl(ctx: FlowContext): string {
  return resolveDenApiUrl(ctx.env);
}

export function denWebUrl(ctx: FlowContext): string {
  return resolveDenWebUrl(ctx.env);
}

export function validateActor(actor: unknown, label = "actor"): Actor {
  if (isRecord(actor) && typeof actor.name === "string" && typeof actor.email === "string" && typeof actor.password === "string" && isActorRole(actor.role)) {
    return { name: actor.name, email: actor.email, password: actor.password, role: actor.role };
  }
  throw new EvalError(`${label} must include name, email, password, and role.`);
}

export function inviteUrlFromToken(webUrl: string, token: string): string {
  const trimmed = token.trim();
  if (!trimmed) throw new EvalError("Invite token is empty; cannot build join URL.");
  const url = new URL("/join-org", `${cleanBaseUrl(webUrl)}/`);
  url.searchParams.set("invite", trimmed);
  return url.toString();
}

export function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

export function normalizeInviteUrl(rawInviteUrl: string, webUrl: string): InviteRef {
  const decoded = decodeHtmlAttribute(rawInviteUrl.trim());
  if (!decoded) throw new EvalError("Invite URL is empty.");
  const parsed = new URL(decoded, `${cleanBaseUrl(webUrl)}/`);
  const token = parsed.searchParams.get("invite")?.trim() ?? "";
  if (!token) throw new EvalError(`Invite URL did not include an invite token: ${decoded}`);
  // Provenance: invite-to-desktop.flow.mjs:741-745 rewrites email-rendered
  // links onto OPENWORK_EVAL_DEN_WEB_URL because the email origin can differ
  // from the browser-driven den-web origin in the local stack.
  const rewritten = new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, `${cleanBaseUrl(webUrl)}/`).toString();
  return { inviteUrl: rewritten, token };
}

export function extractInviteFromHtml(html: string, webUrl: string): InviteRef {
  // Provenance: invite-to-desktop.flow.mjs:687-697 extracts the real
  // /join-org?invite= link from the dev email HTML and validates the token.
  const absolute = html.match(/https?:\/\/[^"'<>\s]+\/join-org\?invite=[^"'<>\s]+/);
  const relative = html.match(/\/join-org\?invite=[^"'<>\s]+/);
  const raw = absolute?.[0] ?? relative?.[0] ?? "";
  if (!raw) throw new EvalError("Invite HTML did not contain a /join-org?invite= link.");
  return normalizeInviteUrl(raw, webUrl);
}

export function extractInviteFromPayload(payload: unknown, webUrl: string): InviteRef {
  const linkKeys = new Set(["inviteUrl", "inviteURL", "inviteLink", "link", "url", "acceptLink"]);
  const tokenKeys = new Set(["inviteToken", "token"]);
  const rawLink = findInviteString(payload, linkKeys, 0);
  if (rawLink) return normalizeInviteUrl(rawLink, webUrl);
  const token = findTokenString(payload, tokenKeys, 0);
  if (token) return { inviteUrl: inviteUrlFromToken(webUrl, token), token };
  throw new EvalError(`Invite payload did not include an invite URL or token: ${JSON.stringify(payload).slice(0, 500)}`);
}

export async function denApiFetch(ctx: FlowContext, path: string, init: RequestInit = {}, options: DenUrlOptions = {}): Promise<DenApiFetchResult> {
  const urls = resolveDenUrls(ctx.env, options);
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body !== undefined) headers.set("content-type", "application/json");
  if (!headers.has("origin")) headers.set("origin", urls.webUrl);
  const response = await fetch(`${webFetchBase(path, urls)}${path}`, { ...init, headers });
  const text = await response.text();
  return { response, text, body: parseJsonText(text) };
}

export async function apiSignIn(ctx: FlowContext, options: ApiSignInOptions): Promise<string> {
  const actor = validateActor(options.actor);
  // Provenance: evals/flows/lib/den-web.mjs:35-42 and
  // invite-to-desktop.flow.mjs:492-507 authenticate through
  // /api/auth/sign-in/email and read the returned Better Auth bearer token.
  const result = await denApiFetch(ctx, "/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: actor.email, password: actor.password }),
  }, options);
  if (!result.response.ok || !isRecord(result.body) || typeof result.body.token !== "string" || !result.body.token.trim()) {
    throw new EvalError(`Den API sign-in failed for ${actor.email}: ${result.response.status} ${result.text.slice(0, 300)}`);
  }
  ctx.log(`Den API sign-in succeeded for ${actor.email}.`);
  return result.body.token;
}

async function navigateAbsolute(ctx: FlowContext, url: string, label = url): Promise<void> {
  await ctx.eval(`(() => { window.location.href = ${JSON.stringify(url)}; return true; })()`);
  await ctx.waitFor("document.readyState === 'complete'", { timeoutMs: 45_000, label: `load ${label}` });
}

async function clearDenWebSession(ctx: FlowContext, webUrl: string): Promise<void> {
  // Provenance: first-connection.flow.mjs:671-685 clears both den-web and
  // proxied den-api auth state before browser sign-in / invite acceptance.
  await navigateAbsolute(ctx, webUrl, "den-web root before sign-out");
  await ctx.eval(`(() => {
    window.localStorage.removeItem(${JSON.stringify(AUTH_TOKEN_STORAGE_KEY)});
    window.sessionStorage.clear();
    return Promise.allSettled([
      fetch('/api/den/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    ]).then(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      return true;
    });
  })()`, { awaitPromise: true });
  if (ctx.client) {
    await ctx.client.send("Network.clearBrowserCookies", {}).catch((error) => ctx.log(`Cookie clear skipped: ${messageText(error)}`));
    await ctx.client.send("Network.clearBrowserCache", {}).catch((error) => ctx.log(`Cache clear skipped: ${messageText(error)}`));
  }
}

async function clickExactText(ctx: FlowContext, text: string, selector = "button, a", timeoutMs = 20_000): Promise<void> {
  await ctx.waitFor(`(() => {
    const normalize = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => normalize(candidate.textContent) === ${JSON.stringify(text)} && candidate.disabled !== true && candidate.getAttribute('aria-disabled') !== 'true');
    element?.scrollIntoView({ block: 'center', inline: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs, label: `click ${text}` });
}

async function clickLastExactText(ctx: FlowContext, text: string, selector = "button", timeoutMs = 20_000): Promise<void> {
  await ctx.waitFor(`(() => {
    const normalize = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .filter((candidate) => normalize(candidate.textContent) === ${JSON.stringify(text)} && candidate.disabled !== true && candidate.getAttribute('aria-disabled') !== 'true');
    const element = candidates[candidates.length - 1];
    element?.scrollIntoView({ block: 'center', inline: 'center' });
    element?.click();
    return Boolean(element);
  })()`, { timeoutMs, label: `click last ${text}` });
}

async function waitForAuthForm(ctx: FlowContext): Promise<void> {
  await ctx.waitFor(
    `document.body.innerText.includes('Sign in')
      || document.body.innerText.includes('Start using OpenWork')
      || Boolean(document.querySelector('input[type="email"], input[name="email"]'))`,
    { timeoutMs: 45_000, label: "den-web auth form" },
  );
}

async function settleDashboard(ctx: FlowContext, autoChoose: boolean): Promise<void> {
  await ctx.waitFor(
    `(() => {
      const text = document.body?.innerText ?? '';
      return text.includes('Dashboard') || Boolean(document.querySelector('[data-testid="org-chooser-root"]')) || location.pathname.startsWith('/dashboard');
    })()`,
    { timeoutMs: 60_000, label: "dashboard or organization chooser" },
  );
  if (!autoChoose) return;
  const chose = await ctx.eval(`(() => {
    const chooser = document.querySelector('[data-testid="org-chooser-list"]');
    if (!chooser) return false;
    const button = chooser.querySelector('button:not([disabled])');
    button?.click();
    return Boolean(button);
  })()`);
  if (chose) ctx.log("Selected the first organization from the Den Web chooser.");
  await ctx.waitFor("location.pathname.startsWith('/dashboard') || document.body.innerText.includes('Dashboard')", {
    timeoutMs: 60_000,
    label: "Den dashboard loaded",
  });
}

async function signInWebOnCurrentSurface(ctx: FlowContext, actor: Actor, autoChoose: boolean): Promise<void> {
  const webUrl = denWebUrl(ctx);
  // Provenance: evals/flows/lib/den-web.mjs:44-105 and
  // first-connection.flow.mjs:623-669 cover the email-first and password
  // forms, including hosted sessions that first render a sign-in affordance.
  await clearDenWebSession(ctx, webUrl);
  await navigateAbsolute(ctx, webUrl, "den-web auth");
  await waitForAuthForm(ctx);
  const hasInitialInput = await ctx.eval("Boolean(document.querySelector('input[type=\"email\"], input[name=\"email\"]')) || Boolean(document.querySelector('input[type=\"password\"]'))");
  if (!hasInitialInput) {
    await clickExactText(ctx, "Sign in", "button, a", 20_000).catch(() => undefined);
  }
  await ctx.waitFor(
    `Boolean(document.querySelector('input[type="email"], input[name="email"]')) || Boolean(document.querySelector('input[type="password"]'))`,
    { timeoutMs: 30_000, label: "auth inputs" },
  );
  const hasEmailInput = await ctx.eval("Boolean(document.querySelector('input[type=\"email\"], input[name=\"email\"]'))");
  const hasPasswordInput = await ctx.eval("Boolean(document.querySelector('input[type=\"password\"]'))");
  if (hasEmailInput) await ctx.fill('input[type="email"], input[name="email"]', actor.email);
  if (hasEmailInput && !hasPasswordInput) {
    const advanced = await ctx.eval(`(() => {
      const form = document.querySelector('input[type="email"], input[name="email"]')?.closest('form');
      const button = [...(form?.querySelectorAll('button') ?? [])].find((entry) => ['Next', 'Continue'].includes((entry.textContent ?? '').trim()))
        ?? form?.querySelector('button[type="submit"]');
      button?.click();
      return Boolean(button);
    })()`);
    ctx.assert(advanced, "No Next button found on the Den Web email step.");
    await ctx.waitFor("Boolean(document.querySelector('input[type=\"password\"]'))", { timeoutMs: 30_000, label: "password step" });
  }
  await ctx.fill('input[type="password"]', actor.password);
  await clickLastExactText(ctx, "Sign in", "button", 20_000);
  await settleDashboard(ctx, autoChoose);
  ctx.log(`Den Web sign-in completed for ${actor.email}.`);
}

async function chooseOrgByName(ctx: FlowContext, name: string): Promise<void> {
  await ctx.waitFor(
    `Boolean(document.querySelector('[data-testid="org-chooser-list"]')) || location.pathname.startsWith('/dashboard')`,
    { timeoutMs: 60_000, label: "organization chooser or dashboard" },
  );
  const pickerResult = await ctx.eval(`(() => {
    const chooser = document.querySelector('[data-testid="org-chooser-list"]');
    if (!chooser) return 'no-chooser';
    const normalize = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
    const button = [...chooser.querySelectorAll('button')].find((entry) => normalize(entry.textContent).includes(${JSON.stringify(name)}) && entry.disabled !== true);
    button?.scrollIntoView({ block: 'center', inline: 'center' });
    button?.click();
    return button ? 'picked' : 'missing';
  })()`);
  if (pickerResult === "missing") throw new EvalError(`Den Web organization chooser did not list ${name}.`);
  if (pickerResult === "picked") {
    await ctx.waitFor("location.pathname.startsWith('/dashboard') || document.body.innerText.includes('Dashboard')", {
      timeoutMs: 60_000,
      label: `dashboard after choosing ${name}`,
    });
    ctx.log(`Verified ${name} in the Den Web organization chooser and selected it.`);
    return;
  }
  const bodyText = await ctx.eval("document.body.innerText");
  if (typeof bodyText === "string" && bodyText.includes(name)) {
    ctx.log(`Verified ${name} in the current Den Web dashboard text.`);
    return;
  }
  throw new EvalError(`Could not verify ${name} in Den Web UI after sign-in.`);
}

async function browserActiveOrganization(ctx: FlowContext): Promise<BrowserOrganization | null> {
  const result = await ctx.eval(`fetch('/api/den/v1/org')
    .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => null) }))
    .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))`, { awaitPromise: true });
  if (!isRecord(result) || result.ok !== true || !isRecord(result.body)) return null;
  const organization = isRecord(result.body.organization) ? result.body.organization : null;
  if (!organization) return null;
  const id = stringField(organization, "id");
  const name = stringField(organization, "name");
  const slug = stringField(organization, "slug");
  return id && name ? { id, name, slug } : null;
}

async function setActiveOrganizationForToken(ctx: FlowContext, token: string, organizationId: string): Promise<void> {
  if (!organizationId) return;
  // Provenance: join-org-invite-clean.flow.mjs:121-132 uses
  // POST /v1/me/active-organization to pin bearer-token calls to the target org.
  const result = await denApiFetch(ctx, "/v1/me/active-organization", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ organizationId }),
  });
  if (!result.response.ok) {
    throw new EvalError(`Could not set active organization ${organizationId} for API session: ${result.response.status} ${result.text.slice(0, 300)}`);
  }
}

async function findPendingInvite(ctx: FlowContext, token: string, email: string): Promise<InviteRef> {
  const org = await denApiFetch(ctx, "/v1/org", { headers: authHeaders(token) });
  if (!org.response.ok) {
    throw new EvalError(`Could not load current organization invitations: ${org.response.status} ${org.text.slice(0, 300)}`);
  }
  return pendingInviteFromOrgBody(org.body, email);
}

async function createInviteViaApi(ctx: FlowContext, actor: Actor, email: string, role: string, activeOrgId?: string): Promise<InviteMemberResult> {
  const token = await apiSignIn(ctx, { actor });
  if (activeOrgId) await setActiveOrganizationForToken(ctx, token, activeOrgId);
  // Provenance: invite-to-desktop.flow.mjs:510-529 and
  // first-connection.flow.mjs:541-554 create real invitations through
  // POST /v1/invitations and read inviteToken/invitationId.
  const created = await denApiFetch(ctx, "/v1/invitations", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ email, role }),
  });
  if (!created.response.ok && created.response.status !== 502) {
    throw new EvalError(`Invitation failed for ${email}: ${created.response.status} ${created.text.slice(0, 500)}`);
  }
  const fromPayload = (() => {
    try {
      return extractInviteFromPayload(created.body, denWebUrl(ctx));
    } catch {
      return {};
    }
  })();
  const pending = fromPayload.token ? fromPayload : await findPendingInvite(ctx, token, email);
  const tokenValue = pending.token ?? "";
  if (!tokenValue) {
    throw new EvalError(`Invitation for ${email} was created but no inviteToken could be resolved.`);
  }
  const inviteUrl = pending.inviteUrl ?? inviteUrlFromToken(denWebUrl(ctx), tokenValue);
  return {
    email,
    inviteUrl,
    token: tokenValue,
    invitationId: pending.invitationId || invitationIdFromBody(created.body),
    path: "api",
  };
}

async function tryInviteViaUi(ctx: FlowContext, email: string, role: string): Promise<boolean> {
  if (role !== DEFAULT_INVITE_ROLE) return false;
  const webUrl = denWebUrl(ctx);
  // Provenance: invite-to-desktop.flow.mjs:67-74 sends the invite through the
  // real Members UI: /dashboard/members -> Add member -> Send invite.
  await navigateAbsolute(ctx, `${webUrl}/dashboard/members`, "/dashboard/members");
  await ctx.waitFor("document.body.innerText.includes('Members') || document.body.innerText.includes('Add member')", {
    timeoutMs: 30_000,
    label: "Members page",
  });
  await clickExactText(ctx, "Add member", "button", 20_000);
  await ctx.waitFor("Boolean(document.querySelector('input[placeholder=\"teammate@example.com\"], input[type=\"email\"]'))", {
    timeoutMs: 20_000,
    label: "invite email input",
  });
  await ctx.fill('input[placeholder="teammate@example.com"], input[type="email"]', email);
  await clickExactText(ctx, "Send invite", "button", 20_000);
  await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(email)})`, { timeoutMs: 30_000, label: "pending invited email" });
  await ctx.waitFor("document.body.innerText.includes('Pending')", { timeoutMs: 20_000, label: "pending invite state" });
  return true;
}

async function markEmailVerifiedIfConfigured(ctx: FlowContext, email: string): Promise<boolean> {
  const command = ctx.env.OPENWORK_EVAL_MARK_VERIFIED_CMD?.trim() ?? "";
  if (!command) return false;
  execSync(command.replaceAll("{email}", email), { stdio: "ignore" });
  ctx.log(`Marked ${email} verified via OPENWORK_EVAL_MARK_VERIFIED_CMD.`);
  return true;
}

async function fillNameIfPresent(ctx: FlowContext, actor: Actor): Promise<void> {
  const hasName = await ctx.eval("Boolean(document.querySelector('input[name=\"name\"], input[autocomplete=\"name\"], input[type=\"text\"]'))");
  if (hasName) await ctx.fill('input[name="name"], input[autocomplete="name"], input[type="text"]', actor.name);
}

async function clickJoinButton(ctx: FlowContext): Promise<void> {
  await ctx.waitFor(`(() => {
    const normalize = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
    const button = [...document.querySelectorAll('button')]
      .find((entry) => normalize(entry.textContent).startsWith('Join ') && entry.disabled !== true && entry.getAttribute('aria-disabled') !== 'true');
    button?.scrollIntoView({ block: 'center', inline: 'center' });
    button?.click();
    return Boolean(button);
  })()`, { timeoutMs: 30_000, label: "join organization button" });
}

async function waitForInviteAccepted(ctx: FlowContext, email: string): Promise<void> {
  await ctx.waitFor(
    `Boolean(document.querySelector('[data-testid="join-org-success"]'))
      || document.body.innerText.includes("You're in")
      || location.pathname.startsWith('/dashboard')`,
    { timeoutMs: 60_000, label: `invite accepted for ${email}` },
  );
}

export async function signInWeb(ctx: FlowContext, options: SignInWebOptions): Promise<{ email: string; webUrl: string }> {
  const actor = validateActor(options.actor);
  await ctx.on(options.surface, async () => signInWebOnCurrentSurface(ctx, actor, true));
  return { email: actor.email, webUrl: denWebUrl(ctx) };
}

export async function signUpWeb(ctx: FlowContext, options: SignInWebOptions): Promise<{ email: string; webUrl: string }> {
  const actor = validateActor(options.actor);
  const webUrl = denWebUrl(ctx);
  await ctx.on(options.surface, async () => {
    // Provenance: new-signin-flow.flow.mjs:189-239 documents the email-first
    // sign-up surface: Start using OpenWork -> email -> Next -> Create your
    // account with name/password and Sign up.
    await clearDenWebSession(ctx, webUrl);
    await navigateAbsolute(ctx, webUrl, "den-web signup");
    await ctx.waitFor("Boolean(document.querySelector('input[type=\"email\"], input[name=\"email\"]')) || location.pathname.startsWith('/dashboard')", {
      timeoutMs: 30_000,
      label: "signup email field or dashboard",
    });
    if (await ctx.eval("location.pathname.startsWith('/dashboard')")) {
      await settleDashboard(ctx, true);
      return;
    }
    await ctx.fill('input[type="email"], input[name="email"]', actor.email);
    await clickExactText(ctx, "Next", "button", 20_000);
    await ctx.waitFor(
      `document.body.innerText.includes('Create your account.')
        || Boolean(document.querySelector('input[type="password"]'))
        || location.pathname.startsWith('/dashboard')`,
      { timeoutMs: 45_000, label: "signup details or dashboard" },
    );
    if (await ctx.eval("location.pathname.startsWith('/dashboard')")) {
      await settleDashboard(ctx, true);
      return;
    }
    await fillNameIfPresent(ctx, actor);
    await ctx.fill('input[type="password"]', actor.password);
    const createMode = await ctx.eval("document.body.innerText.includes('Create your account.')");
    await clickLastExactText(ctx, createMode ? "Sign up" : "Sign in", "button", 20_000);
    await settleDashboard(ctx, true);
  });
  return { email: actor.email, webUrl };
}

export async function createOrg(ctx: FlowContext, options: CreateOrgOptions): Promise<CreateOrgResult> {
  const actor = validateActor(options.actor);
  if (!options.name.trim()) throw new EvalError("createOrg requires a non-empty organization name.");
  const token = await apiSignIn(ctx, { actor });
  // Provenance: org-scope-pinning.flow.mjs:111-128 and
  // join-org-invite-clean.flow.mjs:134-149 use POST /v1/org when no Den Web UI
  // org-creation flow exists in coded evals; this journey keeps that API path
  // and adds browser chooser verification below.
  const created = await denApiFetch(ctx, "/v1/org", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name: options.name }),
  });
  if (!created.response.ok) {
    throw new EvalError(`Creating organization ${options.name} failed: ${created.response.status} ${created.text.slice(0, 500)}`);
  }
  const organization = organizationFromPayload(created.body, options.name, options.slug);
  ctx.log(`Created organization ${organization.name} (${organization.id || organization.slug}) via API; verifying in Den Web chooser.`);
  await ctx.on(options.surface, async () => {
    await signInWebOnCurrentSurface(ctx, actor, false);
    await chooseOrgByName(ctx, organization.name);
    const active = await browserActiveOrganization(ctx);
    if (organization.id && active?.id !== organization.id) {
      throw new EvalError(`Den Web active organization is ${active?.id ?? "unknown"}, expected ${organization.id}.`);
    }
  });
  return { orgId: organization.id || undefined, slug: organization.slug, name: organization.name, path: "api+ui-verify" };
}

export async function inviteMember(ctx: FlowContext, options: InviteMemberOptions): Promise<InviteMemberResult> {
  const actor = validateActor(options.actor);
  const role = options.role?.trim() || DEFAULT_INVITE_ROLE;
  const email = normalizedEmail(options.email);
  if (!email) throw new EvalError("inviteMember requires an email address.");
  if (options.surface) {
    try {
      const activeOrg = await ctx.on(options.surface, async () => {
        const org = await browserActiveOrganization(ctx);
        await tryInviteViaUi(ctx, email, role);
        return org;
      });
      const result = await createInviteViaApi(ctx, actor, email, role, activeOrg?.id);
      ctx.log(`Invited ${email} through the Members UI and resolved its invite token through the API.`);
      return { ...result, path: "ui" };
    } catch (error) {
      ctx.log(`Members UI invite path failed; falling back to API invite for ${email}: ${messageText(error)}`);
    }
  }
  return createInviteViaApi(ctx, actor, email, role);
}

export async function acceptInvite(ctx: FlowContext, options: AcceptInviteOptions): Promise<AcceptInviteResult> {
  const actor = validateActor(options.actor);
  const webUrl = denWebUrl(ctx);
  const invite = options.invite.inviteUrl
    ? normalizeInviteUrl(options.invite.inviteUrl, webUrl)
    : options.invite.token
      ? { inviteUrl: inviteUrlFromToken(webUrl, options.invite.token), token: options.invite.token }
      : null;
  if (!invite?.inviteUrl) throw new EvalError("acceptInvite requires invite.inviteUrl or invite.token.");

  await ctx.on(options.surface, async () => {
    // Provenance: invite-to-desktop.flow.mjs:143-188 and :615-630 drive the
    // invitee browser through /join-org?invite=..., locked-email sign-up, the
    // one-click accept state, and the join success page. The verification
    // command remains optional because local dev stacks can skip verification.
    await clearDenWebSession(ctx, webUrl);
    await navigateAbsolute(ctx, invite.inviteUrl ?? "", "join org invite");
    await ctx.waitFor("document.body.innerText.includes('Join ') || Boolean(document.querySelector('[data-testid=\"join-org-root\"]'))", {
      timeoutMs: 45_000,
      label: "join organization screen",
    });

    const alreadySignedInAccept = await ctx.eval(`(() => {
      const text = document.body.innerText || '';
      return text.includes("You're one click away") || [...document.querySelectorAll('button')].some((button) => (button.textContent ?? '').trim().startsWith('Join '));
    })()`);
    if (!alreadySignedInAccept) {
      await ctx.waitFor("Boolean(document.querySelector('input[type=\"password\"]'))", { timeoutMs: 30_000, label: "invite password field" });
      await fillNameIfPresent(ctx, actor);
      await ctx.fill('input[type="password"]', actor.password);
      await clickJoinButton(ctx);
      await ctx.waitFor(
        `document.body.innerText.includes("You're one click away from the team workspace.")
          || Boolean(document.querySelector('[data-testid="join-org-success"]'))
          || document.body.innerText.includes('Check your inbox.')`,
        { timeoutMs: 60_000, label: "post-signup invite state" },
      );
    }

    if (await ctx.hasText("You're one click away from the team workspace.")) {
      const verified = await markEmailVerifiedIfConfigured(ctx, actor.email);
      if (!verified) ctx.log("OPENWORK_EVAL_MARK_VERIFIED_CMD is not set; attempting invite acceptance directly (local dev may skip verification).");
      await clickJoinButton(ctx);
    }

    if (await ctx.hasText("Check your inbox.")) {
      const verified = await markEmailVerifiedIfConfigured(ctx, actor.email);
      if (!verified) throw new EvalError("Invite acceptance reached email verification; set OPENWORK_EVAL_MARK_VERIFIED_CMD or run against a dev stack that skips verification.");
      await navigateAbsolute(ctx, invite.inviteUrl ?? "", "join org after verification");
      await clickJoinButton(ctx);
    }

    await waitForInviteAccepted(ctx, actor.email);
  });

  return { email: actor.email, inviteUrl: invite.inviteUrl, status: "accepted" };
}
