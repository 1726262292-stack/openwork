import {
  workspaceArtifactLayoutSchema,
  type WorkspaceArtifactLayout,
} from "@openwork/types/dynamic-artifacts";
import { ApiError } from "../errors.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import {
  readWorkspaceArtifactLayout,
  writeWorkspaceArtifactLayout,
} from "../workspace-artifact-layout.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

const MAX_LAYOUT_BYTES = 64 * 1024;

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;

type RegisterArtifactLayoutRoutesOptions = {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
};

function parseLayout(value: unknown): WorkspaceArtifactLayout {
  const parsed = workspaceArtifactLayoutSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_artifact_layout", "Workspace Artifact layout is invalid", {
      issues: parsed.error.issues,
    });
  }
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > MAX_LAYOUT_BYTES) {
    throw new ApiError(413, "artifact_layout_too_large", "Workspace Artifact layout exceeds 64 KiB");
  }
  return parsed.data;
}

export function registerArtifactLayoutRoutes(options: RegisterArtifactLayoutRoutesOptions): void {
  const {
    routes,
    config,
    jsonResponse,
    readJsonBody,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
  } = options;

  addRoute(routes, "GET", "/workspace/:id/artifact-layout", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return jsonResponse(await readWorkspaceArtifactLayout(config, workspace.id));
  });

  addRoute(routes, "PUT", "/workspace/:id/artifact-layout", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const layout = parseLayout(body.layout);
    return jsonResponse(await writeWorkspaceArtifactLayout(config, workspace.id, layout));
  });
}
