import type { ConfigMaterializationService } from "./config-materialization-service.js";
import type { ServerPersistence } from "../database/persistence.js";
import type { JsonObject } from "../database/types.js";
import { RouteError } from "../http.js";
import {
  cloudAppVersionResponseSchema,
  cloudDesktopConfigSchema,
  cloudDesktopHandoffExchangeResponseSchema,
  cloudLlmProviderConnectionResponseSchema,
  cloudLlmProviderListResponseSchema,
  cloudMeResponseSchema,
  cloudOrgSkillCreateResponseSchema,
  cloudOrgSkillHubListResponseSchema,
  cloudOrgSkillListResponseSchema,
  cloudOrganizationsResponseSchema,
  cloudTemplateListResponseSchema,
  cloudTemplateResponseSchema,
  cloudWorkerListResponseSchema,
  cloudWorkerTokensResponseSchema,
  type CloudAppVersionResponse,
  type CloudDesktopConfig,
  type CloudDesktopHandoffExchangeResponse,
  type CloudLlmProvider,
  type CloudLlmProviderConnection,
  type CloudMeResponse,
  type CloudOrganizationsResponse,
  type WorkspaceImportedCloudProvider,
} from "../schemas/cloud.js";

type CloudBaseUrls = {
  apiBaseUrl: string;
  baseUrl: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeUrl(input: string | null | undefined): string | null {
  const value = (input ?? "").trim();
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isTruthy(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isWebAppHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  if (
    normalized === "localhost"
    || normalized === "0.0.0.0"
    || normalized === "::1"
    || normalized === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
  ) {
    return true;
  }

  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [first, second, third, fourth] = ipv4Match.slice(1).map(Number);
    const octets = [first, second, third, fourth];
    if (octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
      if (
        first === 10
        || first === 127
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 169 && second === 254)
        || (first === 100 && second >= 64 && second <= 127)
      ) {
        return true;
      }
    }
  }

  return normalized === "app.openworklabs.com" || normalized === "app.openwork.software" || normalized.startsWith("app.");
}

function ensureDenApiBasePath(input: string): string {
  const normalized = normalizeUrl(input);
  if (!normalized) {
    return input;
  }

  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.toLowerCase().endsWith("/api/den")) {
      return normalized;
    }
    url.pathname = `${pathname}/api/den`.replace(/\/+/g, "/");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return normalized;
  }
}

function deriveDenApiBaseUrl(input: string): string {
  const normalized = normalizeUrl(input) ?? "https://app.openworklabs.com";

  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.toLowerCase().endsWith("/api/den")) {
      return normalized;
    }
    if (isWebAppHost(url.hostname)) {
      return ensureDenApiBasePath(normalized);
    }
  } catch {
    return normalized;
  }

  return normalized;
}

function normalizeVersion(value: string | undefined, fallback = "") {
  const trimmed = (value ?? "").trim().replace(/^v/i, "");
  return trimmed || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

export class CloudProxyError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
    message: string,
  ) {
    super(message);
    this.name = "CloudProxyError";
  }
}

export type CloudService = ReturnType<typeof createCloudService>;

export function createCloudService(input: {
  config: ConfigMaterializationService;
  repositories: ServerPersistence["repositories"];
  serverId: string;
  version: string;
}) {
  const defaultCloudBaseUrl = normalizeUrl(process.env.OPENWORK_SERVER_V2_CLOUD_BASE_URL) ?? "https://app.openworklabs.com";
  const configuredApiBaseUrl = normalizeUrl(process.env.OPENWORK_SERVER_V2_CLOUD_API_BASE_URL);
  const defaultRequireSignin = isTruthy(process.env.OPENWORK_SERVER_V2_CLOUD_REQUIRE_SIGNIN);
  const fallbackLatestAppVersion = normalizeVersion(process.env.OPENWORK_SERVER_V2_LATEST_APP_VERSION, input.version);
  const fallbackMinAppVersion = normalizeVersion(process.env.OPENWORK_SERVER_V2_MIN_APP_VERSION, fallbackLatestAppVersion);

  function getPrimarySignin() {
    return input.repositories.cloudSignin.getPrimary();
  }

  function resolveCloudBaseUrls(): CloudBaseUrls {
    const record = getPrimarySignin();
    const baseUrl = normalizeUrl(record?.cloudBaseUrl) ?? defaultCloudBaseUrl;
    return {
      baseUrl,
      apiBaseUrl: configuredApiBaseUrl ?? deriveDenApiBaseUrl(baseUrl),
    };
  }

  function resolveRequestUrl(path: string) {
    const baseUrls = resolveCloudBaseUrls();
    const baseUrl = path.startsWith("/api/") ? baseUrls.baseUrl : baseUrls.apiBaseUrl;
    return `${baseUrl}${path}`;
  }

  function readToken() {
    const auth = getPrimarySignin()?.auth;
    if (!isRecord(auth)) {
      return null;
    }

    const authToken = typeof auth.authToken === "string" ? auth.authToken.trim() : "";
    const token = typeof auth.token === "string" ? auth.token.trim() : "";
    return authToken || token || null;
  }

  function requireToken() {
    const token = readToken();
    if (!token) {
      throw new RouteError(401, "unauthorized", "Cloud signin is not configured.");
    }
    return token;
  }

  function updateSigninRecord(updater: (current: ReturnType<typeof getPrimarySignin>) => Parameters<ServerPersistence["repositories"]["cloudSignin"]["upsert"]>[0] | null) {
    const current = getPrimarySignin();
    const next = updater(current);
    if (!next) {
      return current;
    }

    return input.repositories.cloudSignin.upsert(next);
  }

  async function requestCloud(path: string, options: {
    body?: unknown;
    method?: string;
    token?: string | null;
  } = {}) {
    const headers = new Headers({ Accept: "application/json" });
    if (options.token) {
      headers.set("Authorization", `Bearer ${options.token}`);
    }
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetch(resolveRequestUrl(path), {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new RouteError(502, "bad_gateway", error instanceof Error ? error.message : "Cloud request failed.");
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }

    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `Cloud request failed with ${response.status}.`;
      throw new CloudProxyError(response.status, payload, message);
    }

    return payload;
  }

  function persistSessionMetadata(payload: CloudMeResponse) {
    const current = getPrimarySignin();
    if (!current) {
      return;
    }

    updateSigninRecord(() => ({
      ...current,
      lastValidatedAt: nowIso(),
      metadata: {
        ...(current.metadata ?? {}),
        session: payload.session,
        validatedUser: payload.user,
      },
      userId: payload.user.id,
    }));
  }

  function persistOrganizationMetadata(payload: CloudOrganizationsResponse) {
    const current = getPrimarySignin();
    if (!current) {
      return;
    }

    const activeOrg = payload.orgs.find((org) => org.id === payload.activeOrgId)
      ?? payload.orgs.find((org) => org.slug === payload.activeOrgSlug)
      ?? null;

    updateSigninRecord(() => ({
      ...current,
      metadata: {
        ...(current.metadata ?? {}),
        activeOrgName: typeof activeOrg?.name === "string" ? activeOrg.name : null,
        activeOrgSlug: payload.activeOrgSlug,
        organizations: payload.orgs,
      },
      orgId: payload.activeOrgId,
    }));
  }

  function getStringList(value: unknown) {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [] as string[];
  }

  function getCloudProviderEnv(config: Record<string, unknown>) {
    return getStringList(config.env);
  }

  function buildCloudProviderConfig(provider: CloudLlmProviderConnection): JsonObject {
    const models = Object.fromEntries(
      provider.models.map((model) => {
        const next: Record<string, unknown> = {
          id: model.id,
          name: model.name,
        };
        const raw = model.config;
        for (const key of [
          "family",
          "release_date",
          "attachment",
          "reasoning",
          "temperature",
          "tool_call",
          "interleaved",
          "cost",
          "limit",
          "modalities",
          "status",
          "options",
          "headers",
          "provider",
          "variants",
        ] as const) {
          const value = raw[key];
          if (value !== undefined) {
            next[key] = value;
          }
        }
        return [model.id, next] as const;
      }),
    );

    const next: JsonObject = {
      id: provider.providerId,
      name: provider.name,
      env: getCloudProviderEnv(provider.providerConfig),
      models,
    };

    if (typeof provider.providerConfig.npm === "string" && provider.providerConfig.npm.trim()) {
      next.npm = provider.providerConfig.npm;
    }
    if (typeof provider.providerConfig.api === "string" && provider.providerConfig.api.trim()) {
      next.api = provider.providerConfig.api;
    }
    if (provider.providerConfig.options && typeof provider.providerConfig.options === "object" && !Array.isArray(provider.providerConfig.options)) {
      next.options = provider.providerConfig.options as Record<string, unknown>;
    }
    if (Array.isArray(provider.providerConfig.whitelist)) {
      next.whitelist = getStringList(provider.providerConfig.whitelist);
    }
    if (Array.isArray(provider.providerConfig.blacklist)) {
      next.blacklist = getStringList(provider.providerConfig.blacklist);
    }

    return next;
  }

  function readImportedProviders(openwork: JsonObject): Record<string, WorkspaceImportedCloudProvider> {
    const cloudImports = isRecord(openwork.cloudImports) ? openwork.cloudImports : {};
    const providers = isRecord(cloudImports.providers) ? cloudImports.providers : {};
    return Object.fromEntries(
      Object.entries(providers)
        .map(([key, value]) => {
          if (!isRecord(value)) {
            return null;
          }
          const cloudProviderId = typeof value.cloudProviderId === "string" ? value.cloudProviderId.trim() : key.trim();
          const providerId = typeof value.providerId === "string" ? value.providerId.trim() : "";
          const sourceProviderId = typeof value.sourceProviderId === "string" ? value.sourceProviderId.trim() : providerId;
          const name = typeof value.name === "string" ? value.name.trim() : providerId || cloudProviderId;
          if (!cloudProviderId || !providerId || !sourceProviderId || !name) {
            return null;
          }
          return [cloudProviderId, {
            cloudProviderId,
            providerId,
            sourceProviderId,
            name,
            source: typeof value.source === "string" ? value.source.trim() || null : null,
            updatedAt: typeof value.updatedAt === "string" ? value.updatedAt.trim() || null : null,
            modelIds: getStringList(value.modelIds).sort(),
            importedAt: typeof value.importedAt === "number" && Number.isFinite(value.importedAt) ? value.importedAt : null,
          } satisfies WorkspaceImportedCloudProvider] as const;
        })
        .filter((entry): entry is readonly [string, WorkspaceImportedCloudProvider] => Boolean(entry)),
    );
  }

  function buildImportedProviderRecord(provider: CloudLlmProviderConnection): WorkspaceImportedCloudProvider {
    return {
      cloudProviderId: provider.id,
      importedAt: Date.now(),
      modelIds: provider.models.map((model) => model.id.trim()).filter(Boolean).sort(),
      name: provider.name,
      providerId: provider.providerId,
      source: provider.source,
      sourceProviderId: provider.providerId,
      updatedAt: provider.updatedAt,
    };
  }

  async function getWorkspaceProviderState(workspaceId: string) {
    const snapshot = await input.config.getWorkspaceConfigSnapshot(workspaceId);
    const disabledProviders = getStringList(snapshot.stored.opencode.disabled_providers);
    const importedProviders = readImportedProviders(snapshot.stored.openwork);
    return {
      disabledProviders,
      importedProviders,
      snapshot,
    };
  }

  async function writeImportedProviders(workspaceId: string, nextProviders: Record<string, WorkspaceImportedCloudProvider>) {
    return input.config.updateWorkspaceOpenworkConfig(workspaceId, (current) => {
      const cloudImports = isRecord(current.cloudImports) ? { ...current.cloudImports } : {};
      cloudImports.providers = nextProviders;
      return {
        ...current,
        cloudImports,
      };
    });
  }

  function assertCloudImportSafe(workspaceId: string, provider: CloudLlmProviderConnection, importedProviders: Record<string, WorkspaceImportedCloudProvider>) {
    const existingImported = Object.values(importedProviders).find((entry) => entry.providerId === provider.providerId);
    if (existingImported && existingImported.cloudProviderId !== provider.id) {
      throw new RouteError(
        409,
        "conflict",
        `${provider.providerId} is already imported from ${existingImported.name}. Remove it before importing a different cloud provider.`,
      );
    }

    const assigned = input.config.listWorkspaceProviderConfigs(workspaceId);
    const conflicting = assigned.find((item) => (item.key ?? item.displayName) === provider.providerId);
    if (conflicting && conflicting.cloudItemId !== provider.id && !existingImported) {
      throw new RouteError(
        409,
        "conflict",
        `${provider.providerId} already exists in this workspace. Remove the existing provider config before importing the cloud-managed version.`,
      );
    }
  }

  return {
    getBootstrapConfig() {
      const baseUrls = resolveCloudBaseUrls();
      return {
        apiBaseUrl: baseUrls.apiBaseUrl,
        baseUrl: baseUrls.baseUrl,
        requireSignin: defaultRequireSignin,
      };
    },

    async exchangeDesktopHandoff(grant: string): Promise<CloudDesktopHandoffExchangeResponse> {
      const payload = await requestCloud("/v1/auth/desktop-handoff/exchange", {
        method: "POST",
        body: { grant },
      });
      const parsed = cloudDesktopHandoffExchangeResponseSchema.parse(payload);
      if (parsed.token) {
        const current = getPrimarySignin();
        const baseUrls = resolveCloudBaseUrls();
        input.repositories.cloudSignin.upsert({
          auth: { authToken: parsed.token },
          cloudBaseUrl: baseUrls.baseUrl,
          id: current?.id ?? `cloud_${input.serverId}`,
          lastValidatedAt: parsed.user ? nowIso() : null,
          metadata: {
            ...(current?.metadata ?? {}),
            validatedUser: parsed.user,
          },
          orgId: current?.orgId ?? null,
          serverId: input.serverId,
          userId: parsed.user?.id ?? current?.userId ?? null,
        });
      }
      return parsed;
    },

    async getSession(): Promise<CloudMeResponse> {
      const payload = await requestCloud("/v1/me", {
        token: requireToken(),
      });
      const parsed = cloudMeResponseSchema.parse(payload);
      persistSessionMetadata(parsed);
      return parsed;
    },

    async getOrganizations(): Promise<CloudOrganizationsResponse> {
      const payload = await requestCloud("/v1/me/orgs", {
        token: requireToken(),
      });
      const parsed = cloudOrganizationsResponseSchema.parse(payload);
      persistOrganizationMetadata(parsed);
      return parsed;
    },

    async setActiveOrganization(inputValue: { organizationId?: string | null; organizationSlug?: string | null }) {
      await requestCloud("/api/auth/organization/set-active", {
        method: "POST",
        token: requireToken(),
        body: {
          organizationId: inputValue.organizationId?.trim() || undefined,
          organizationSlug: inputValue.organizationSlug?.trim() || undefined,
        },
      });

      const orgs = await this.getOrganizations();
      return {
        activeOrgId: orgs.activeOrgId,
        activeOrgSlug: orgs.activeOrgSlug,
        ok: true as const,
      };
    },

    async getDesktopConfig(): Promise<CloudDesktopConfig> {
      const payload = await requestCloud("/v1/me/desktop-config", {
        token: requireToken(),
      });
      return cloudDesktopConfigSchema.parse(payload);
    },

    async listLlmProviders(): Promise<CloudLlmProvider[]> {
      const payload = await requestCloud("/v1/llm-providers", {
        token: requireToken(),
      });
      return cloudLlmProviderListResponseSchema.parse(payload).llmProviders;
    },

    async getLlmProviderConnection(cloudProviderId: string): Promise<CloudLlmProviderConnection> {
      const payload = await requestCloud(`/v1/llm-providers/${encodeURIComponent(cloudProviderId)}/connect`, {
        token: requireToken(),
      });
      return cloudLlmProviderConnectionResponseSchema.parse(payload).llmProvider;
    },

    async listWorkers(limit = 20) {
      const query = new URLSearchParams();
      query.set("limit", String(limit));
      const payload = await requestCloud(`/v1/workers?${query.toString()}`, {
        token: requireToken(),
      });
      const parsed = isRecord(payload) && Array.isArray(payload.workers)
        ? {
            workers: payload.workers.map((entry) => {
              const record = isRecord(entry) ? entry : {};
              const instance = isRecord(record.instance) ? record.instance : null;
              return {
                workerId: typeof record.id === "string" ? record.id : "",
                workerName: typeof record.name === "string" ? record.name : "",
                status: typeof record.status === "string" ? record.status : "unknown",
                instanceUrl: instance && typeof instance.url === "string" ? instance.url : null,
                provider: instance && typeof instance.provider === "string" ? instance.provider : null,
                isMine: Boolean(record.isMine),
                createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
              };
            }),
          }
        : payload;
      return cloudWorkerListResponseSchema.parse(parsed);
    },

    async getWorkerTokens(workerId: string) {
      const payload = await requestCloud(`/v1/workers/${encodeURIComponent(workerId)}/tokens`, {
        body: {},
        method: "POST",
        token: requireToken(),
      });
      return cloudWorkerTokensResponseSchema.parse(payload);
    },

    async listTemplates() {
      const payload = await requestCloud("/v1/templates", {
        token: requireToken(),
      });
      return cloudTemplateListResponseSchema.parse(payload);
    },

    async createTemplate(inputValue: { name: string; templateData: unknown }) {
      const payload = await requestCloud("/v1/templates", {
        body: inputValue,
        method: "POST",
        token: requireToken(),
      });
      return cloudTemplateResponseSchema.parse(payload);
    },

    async deleteTemplate(templateId: string) {
      await requestCloud(`/v1/templates/${encodeURIComponent(templateId)}`, {
        method: "DELETE",
        token: requireToken(),
      });
      return null;
    },

    async listOrgSkills() {
      const payload = await requestCloud("/v1/skills", {
        token: requireToken(),
      });
      return cloudOrgSkillListResponseSchema.parse(payload);
    },

    async listOrgSkillHubs() {
      const payload = await requestCloud("/v1/skill-hubs", {
        token: requireToken(),
      });
      return cloudOrgSkillHubListResponseSchema.parse(payload);
    },

    async createOrgSkill(inputValue: { shared?: "org" | "public" | null; skillText: string }) {
      const payload = await requestCloud("/v1/skills", {
        body: inputValue,
        method: "POST",
        token: requireToken(),
      });
      return cloudOrgSkillCreateResponseSchema.parse(payload);
    },

    async addOrgSkillToHub(skillHubId: string, skillId: string) {
      return await requestCloud(`/v1/skill-hubs/${encodeURIComponent(skillHubId)}/skills`, {
        body: { skillId },
        method: "POST",
        token: requireToken(),
      });
    },

    async getAppVersionMetadata(): Promise<CloudAppVersionResponse> {
      try {
        const payload = await requestCloud("/v1/app-version");
        return cloudAppVersionResponseSchema.parse(payload);
      } catch (error) {
        if (fallbackLatestAppVersion) {
          return {
            latestAppVersion: fallbackLatestAppVersion,
            minAppVersion: fallbackMinAppVersion,
          };
        }

        throw error;
      }
    },

    async getWorkspaceCloudProviderState(workspaceId: string) {
      const state = await getWorkspaceProviderState(workspaceId);
      return {
        disabledProviders: state.disabledProviders,
        importedProviders: state.importedProviders,
      };
    },

    async setWorkspaceDisabledProviders(workspaceId: string, providerIds: string[]) {
      const snapshot = input.config.setWorkspaceDisabledProviders(workspaceId, providerIds);
      const state = await getWorkspaceProviderState(workspaceId);
      return {
        disabledProviders: state.disabledProviders,
        importedProviders: state.importedProviders,
        snapshot,
      };
    },

    async importWorkspaceCloudProvider(workspaceId: string, cloudProviderId: string) {
      const state = await getWorkspaceProviderState(workspaceId);
      const provider = await this.getLlmProviderConnection(cloudProviderId);
      assertCloudImportSafe(workspaceId, provider, state.importedProviders);

      const existingImported = state.importedProviders[cloudProviderId] ?? null;
      if (!provider.apiKey && getCloudProviderEnv(provider.providerConfig).length > 0) {
        throw new RouteError(400, "invalid_request", `${provider.name} does not have a stored organization credential yet.`);
      }

      if (existingImported?.providerId && existingImported.providerId !== provider.providerId) {
        input.config.removeWorkspaceProviderConfig(workspaceId, existingImported.providerId);
      }

      const snapshot = input.config.upsertWorkspaceProviderConfig(workspaceId, {
        auth: provider.apiKey ? { key: provider.apiKey, type: "api" } : null,
        cloudItemId: provider.id,
        config: buildCloudProviderConfig(provider),
        displayName: provider.name,
        key: provider.providerId,
        metadata: {
          importedVia: "cloud_sync",
          modelIds: provider.models.map((model) => model.id),
          sourceProviderId: provider.providerId,
          workspaceId,
        },
        source: "cloud_synced",
      });

      const nextImportedProviders = {
        ...state.importedProviders,
        [provider.id]: buildImportedProviderRecord(provider),
      };
      await writeImportedProviders(workspaceId, nextImportedProviders);
      const nextDisabledProviders = state.disabledProviders.filter((id) => id !== provider.providerId && id !== existingImported?.providerId);
      input.config.setWorkspaceDisabledProviders(workspaceId, nextDisabledProviders);
      const nextState = await getWorkspaceProviderState(workspaceId);
      return {
        disabledProviders: nextState.disabledProviders,
        importedProviders: nextState.importedProviders,
        snapshot,
      };
    },

    async removeWorkspaceCloudProvider(workspaceId: string, cloudProviderId: string) {
      const state = await getWorkspaceProviderState(workspaceId);
      const imported = state.importedProviders[cloudProviderId];
      if (!imported) {
        throw new RouteError(404, "not_found", `Cloud provider not imported: ${cloudProviderId}`);
      }

      const snapshot = input.config.removeWorkspaceProviderConfig(workspaceId, imported.providerId);
      const nextImportedProviders = { ...state.importedProviders };
      delete nextImportedProviders[cloudProviderId];
      await writeImportedProviders(workspaceId, nextImportedProviders);
      input.config.setWorkspaceDisabledProviders(workspaceId, state.disabledProviders.filter((id) => id !== imported.providerId));
      const nextState = await getWorkspaceProviderState(workspaceId);
      return {
        disabledProviders: nextState.disabledProviders,
        importedProviders: nextState.importedProviders,
        snapshot,
      };
    },

    async syncWorkspaceCloudProviders(workspaceId: string) {
      const currentState = await getWorkspaceProviderState(workspaceId);
      const providers = await this.listLlmProviders();
      const currentById = new Map(providers.map((provider) => [provider.id, provider] as const));

      const added: string[] = [];
      const removed: string[] = [];
      const updated: string[] = [];

      for (const cloudProviderId of Object.keys(currentState.importedProviders)) {
        if (!currentById.has(cloudProviderId)) {
          await this.removeWorkspaceCloudProvider(workspaceId, cloudProviderId);
          removed.push(cloudProviderId);
        }
      }

      let latestState = await getWorkspaceProviderState(workspaceId);
      for (const provider of providers) {
        const imported = latestState.importedProviders[provider.id] ?? null;
        const modelIds = provider.models.map((model) => model.id.trim()).filter(Boolean).sort();
        const changed = !imported
          || imported.providerId !== provider.providerId
          || imported.sourceProviderId !== provider.providerId
          || imported.updatedAt !== provider.updatedAt
          || imported.name !== provider.name
          || imported.source !== provider.source
          || imported.modelIds.join("\n") !== modelIds.join("\n");

        if (!changed) {
          continue;
        }

        await this.importWorkspaceCloudProvider(workspaceId, provider.id);
        if (imported) {
          updated.push(provider.id);
        } else {
          added.push(provider.id);
        }
        latestState = await getWorkspaceProviderState(workspaceId);
      }

      const importedProviderIds = new Set(
        Object.values(latestState.importedProviders).map((entry) => entry.providerId),
      );
      const nextDisabledProviders = latestState.disabledProviders.filter((id) => !importedProviderIds.has(id));
      if (nextDisabledProviders.length !== latestState.disabledProviders.length) {
        input.config.setWorkspaceDisabledProviders(workspaceId, nextDisabledProviders);
        latestState = await getWorkspaceProviderState(workspaceId);
      }

      return {
        added,
        disabledProviders: latestState.disabledProviders,
        importedProviders: latestState.importedProviders,
        removed,
        snapshot: latestState.snapshot,
        updated,
      };
    },
  };
}
