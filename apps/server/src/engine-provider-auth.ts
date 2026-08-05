import { createHash } from "node:crypto";

import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";
import { loopbackFetch } from "./server-fetch.js";
import type { ServerConfig } from "./types.js";
import { findManagedEngineWorkspace } from "./workspaces.js";

type EngineProviderAuthFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type EngineProviderAuthLogger = {
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

export type EngineProviderAuthFailure = {
  providerId: string;
  operation: "put" | "delete";
  status: number | null;
};

export type EngineProviderAuthResult = {
  delivered: string[];
  unchanged: string[];
  removed: string[];
  failed: EngineProviderAuthFailure[];
};

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
const fingerprintKey = (baseUrl: string, directory: string | null, providerId: string) =>
  `${baseUrl}\u0000${directory ?? ""}\u0000${providerId}`;

function workspaceDirectory(workspace: ReturnType<typeof findManagedEngineWorkspace>): string | null {
  if (!workspace) return null;
  const directory = workspace.directory?.trim()
    || (workspace.workspaceType === "local" ? workspace.path.trim() : "");
  if (!directory) return null;
  const normalized = process.platform === "win32"
    ? directory.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "")
    : directory;
  return encodeURIComponent(normalized);
}

/**
 * A credential delivery scope owns only the engine auth ids it successfully
 * PUTs. This keeps independent server features from deleting credentials they
 * did not install while sharing the same fingerprint and engine-auth behavior.
 */
export function createEngineProviderAuthDelivery() {
  const deliveredFingerprints = new Map<string, string>();

  return {
    reset(): void {
      deliveredFingerprints.clear();
    },

    async sync(input: {
      config: ServerConfig;
      retainedProviderIds: ReadonlySet<string>;
      credentials: ReadonlyMap<string, string>;
      force?: boolean;
      fetchImpl?: EngineProviderAuthFetch;
      logger?: EngineProviderAuthLogger;
    }): Promise<EngineProviderAuthResult> {
      const result: EngineProviderAuthResult = {
        delivered: [],
        unchanged: [],
        removed: [],
        failed: [],
      };
      const fetchImpl: EngineProviderAuthFetch = input.fetchImpl
        ?? ((url, init) => loopbackFetch(url, init));
      const managedWorkspaces = input.config.workspaces.filter(
        (workspace) => workspace.workspaceType !== "remote" && workspace.path.trim() !== "",
      );
      const workspaces = managedWorkspaces.length > 0
        ? managedWorkspaces
        : [findManagedEngineWorkspace(input.config.workspaces) ?? input.config.workspaces[0]].filter(
            (workspace) => workspace !== undefined,
          );

      for (const workspace of workspaces) {
        const connection = resolveWorkspaceOpencodeConnection(input.config, workspace);
        const baseUrl = connection.baseUrl?.replace(/\/+$/, "");
        if (!baseUrl) continue;
        const directory = workspaceDirectory(workspace);
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (connection.authHeader) headers.authorization = connection.authHeader;
        if (directory) headers["x-opencode-directory"] = directory;

        for (const [providerId, credential] of input.credentials) {
          if (!input.retainedProviderIds.has(providerId)) continue;
          const key = fingerprintKey(baseUrl, directory, providerId);
          const nextFingerprint = fingerprint(credential);
          if (!input.force && deliveredFingerprints.get(key) === nextFingerprint) {
            if (!result.unchanged.includes(providerId)) result.unchanged.push(providerId);
            continue;
          }

          try {
            const response = await fetchImpl(`${baseUrl}/auth/${encodeURIComponent(providerId)}`, {
              method: "PUT",
              headers,
              body: JSON.stringify({ type: "api", key: credential }),
            });
            if (!response.ok) {
              result.failed.push({ providerId, operation: "put", status: response.status });
              input.logger?.error("provider auth delivery rejected by engine", {
                provider_id: providerId,
                status: response.status,
              });
              continue;
            }
            deliveredFingerprints.set(key, nextFingerprint);
            if (!result.delivered.includes(providerId)) result.delivered.push(providerId);
          } catch (error) {
            result.failed.push({ providerId, operation: "put", status: null });
            input.logger?.error("provider auth delivery failed", {
              provider_id: providerId,
              message: error instanceof Error ? error.message : "unknown_error",
            });
          }
        }

        for (const key of [...deliveredFingerprints.keys()]) {
          const [keyBaseUrl, keyDirectory, providerId] = key.split("\u0000");
          if (
            !providerId
            || keyBaseUrl !== baseUrl
            || keyDirectory !== (directory ?? "")
            || input.retainedProviderIds.has(providerId)
          ) continue;
          try {
            const response = await fetchImpl(`${baseUrl}/auth/${encodeURIComponent(providerId)}`, {
              method: "DELETE",
              headers,
            });
            if (!response.ok) {
              result.failed.push({ providerId, operation: "delete", status: response.status });
              input.logger?.error("provider auth removal rejected by engine", {
                provider_id: providerId,
                status: response.status,
              });
              continue;
            }
            deliveredFingerprints.delete(key);
            if (!result.removed.includes(providerId)) result.removed.push(providerId);
          } catch (error) {
            result.failed.push({ providerId, operation: "delete", status: null });
            input.logger?.error("provider auth removal failed", {
              provider_id: providerId,
              message: error instanceof Error ? error.message : "unknown_error",
            });
          }
        }
      }

      return result;
    },
  };
}
