import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Context } from "hono";
import { ZodError } from "zod";
import { getRequestContext, type AppBindings } from "../context/request-context.js";
import { buildSuccessResponse, RouteError } from "../http.js";
import { jsonResponse } from "../openapi.js";
import {
  cloudAppVersionResponseSchema,
  cloudCompatErrorSchema,
  cloudDesktopConfigSchema,
  cloudDesktopHandoffExchangeRequestSchema,
  cloudDesktopHandoffExchangeResponseSchema,
  cloudLlmProviderConnectionResponseSchema,
  cloudLlmProviderListResponseSchema,
  cloudMeResponseSchema,
  cloudOrgSkillCreateRequestSchema,
  cloudOrgSkillCreateResponseSchema,
  cloudOrgSkillHubAddSkillRequestSchema,
  cloudOrgSkillHubAddSkillResponseSchema,
  cloudOrgSkillHubListResponseSchema,
  cloudOrgSkillListResponseSchema,
  cloudOrganizationsResponseSchema,
  cloudSetActiveOrganizationRequestSchema,
  cloudSetActiveOrganizationResponseSchema,
  cloudTemplateCreateRequestSchema,
  cloudTemplateListResponseSchema,
  cloudTemplateResponseSchema,
  cloudWorkerListResponseSchema,
  cloudWorkerTokensResponseSchema,
  workspaceCloudProviderMutationResponseSchema,
  workspaceCloudProviderStateResponseSchema,
  workspaceCloudProviderSyncResponseSchema,
  workspaceDisabledProvidersWriteSchema,
} from "../schemas/cloud.js";
import { CloudProxyError } from "../services/cloud-service.js";
import { routePaths } from "./route-paths.js";

function parseJsonBody<T>(schema: { parse(input: unknown): T }, request: Request) {
  return request.json().then((body) => schema.parse(body));
}

function compatErrorPayload(error: { code: string; details?: unknown; message: string }) {
  return {
    details: error.details,
    error: error.code,
    message: error.message,
  };
}

function respondWithCompatError(c: Context<AppBindings>, error: unknown) {
  if (error instanceof CloudProxyError) {
    const payload = error.payload;
    if (payload && typeof payload === "object") {
      return c.json(payload, error.status as any);
    }

    return c.json(compatErrorPayload({ code: "bad_gateway", message: error.message }), error.status as any);
  }

  if (error instanceof RouteError) {
    return c.json(compatErrorPayload({ code: error.code, details: error.details, message: error.message }), error.status as any);
  }

  if (error instanceof ZodError) {
    return c.json(compatErrorPayload({
      code: "invalid_request",
      details: error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path,
      })),
      message: "Request validation failed.",
    }), 400);
  }

  throw error;
}

export function registerCloudRoutes(app: Hono<AppBindings>) {
  app.get(
    routePaths.v1.appVersion,
    describeRoute({
      tags: ["Cloud"],
      summary: "Get cloud app version metadata",
      description: "Returns the current cloud-controlled desktop version metadata through Server V2.",
      responses: {
        200: jsonResponse("Cloud app version metadata returned successfully.", cloudAppVersionResponseSchema),
        500: jsonResponse("The server failed to return app version metadata.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        return c.json(await getRequestContext(c).services.cloud.getAppVersionMetadata());
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.post(
    routePaths.v1.auth.desktopHandoffExchange,
    describeRoute({
      tags: ["Cloud"],
      summary: "Exchange a desktop handoff grant",
      description: "Exchanges a cloud desktop handoff grant and persists the resulting cloud signin state in Server V2.",
      responses: {
        200: jsonResponse("Desktop handoff exchanged successfully.", cloudDesktopHandoffExchangeResponseSchema),
        400: jsonResponse("The desktop handoff request body was invalid.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to exchange the handoff grant.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const body = await parseJsonBody(cloudDesktopHandoffExchangeRequestSchema, c.req.raw);
        return c.json(await getRequestContext(c).services.cloud.exchangeDesktopHandoff(body.grant));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.get(
    routePaths.v1.llmProviders,
    describeRoute({
      tags: ["Cloud"],
      summary: "List cloud LLM providers",
      description: "Returns the cloud LLM providers visible to the active organization through Server V2.",
      responses: {
        200: jsonResponse("Cloud LLM providers returned successfully.", cloudLlmProviderListResponseSchema),
        401: jsonResponse("Cloud signin is required to list LLM providers.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to list cloud LLM providers.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        return c.json({ llmProviders: await getRequestContext(c).services.cloud.listLlmProviders() });
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.get(
    routePaths.v1.llmProviderConnect(),
    describeRoute({
      tags: ["Cloud"],
      summary: "Get a cloud LLM provider connect payload",
      description: "Returns one cloud LLM provider with its concrete connection details through Server V2.",
      responses: {
        200: jsonResponse("Cloud LLM provider connection payload returned successfully.", cloudLlmProviderConnectionResponseSchema),
        401: jsonResponse("Cloud signin is required to read the provider connect payload.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to read the cloud provider connect payload.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const llmProviderId = c.req.param("llmProviderId") ?? "";
        return c.json({ llmProvider: await getRequestContext(c).services.cloud.getLlmProviderConnection(llmProviderId) });
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.get(
    routePaths.v1.workers,
    describeRoute({
      tags: ["Cloud"],
      summary: "List cloud workers",
      description: "Returns the active-organization worker list through Server V2.",
      responses: {
        200: jsonResponse("Cloud workers returned successfully.", cloudWorkerListResponseSchema),
        401: jsonResponse("Cloud signin is required to list workers.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to list cloud workers.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const limit = Number.parseInt(new URL(c.req.url).searchParams.get("limit") ?? "20", 10);
        return c.json(await getRequestContext(c).services.cloud.listWorkers(Number.isFinite(limit) ? limit : 20));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.post(
    routePaths.v1.workerTokens(),
    describeRoute({
      tags: ["Cloud"],
      summary: "Get cloud worker tokens",
      description: "Returns connect tokens for one active-organization worker through Server V2.",
      responses: {
        200: jsonResponse("Cloud worker tokens returned successfully.", cloudWorkerTokensResponseSchema),
        401: jsonResponse("Cloud signin is required to read worker tokens.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to read cloud worker tokens.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const workerId = c.req.param("workerId") ?? "";
        return c.json(await getRequestContext(c).services.cloud.getWorkerTokens(workerId));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.get(
    routePaths.v1.templates,
    describeRoute({
      tags: ["Cloud"],
      summary: "List cloud templates",
      description: "Returns the active-organization templates through Server V2.",
      responses: {
        200: jsonResponse("Cloud templates returned successfully.", cloudTemplateListResponseSchema),
        401: jsonResponse("Cloud signin is required to list templates.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to list cloud templates.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        return c.json(await getRequestContext(c).services.cloud.listTemplates());
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.post(
    routePaths.v1.templates,
    describeRoute({
      tags: ["Cloud"],
      summary: "Create a cloud template",
      description: "Creates an active-organization template through Server V2.",
      responses: {
        200: jsonResponse("Cloud template created successfully.", cloudTemplateResponseSchema),
        400: jsonResponse("The template creation payload was invalid.", cloudCompatErrorSchema),
        401: jsonResponse("Cloud signin is required to create templates.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to create the cloud template.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const body = await parseJsonBody(cloudTemplateCreateRequestSchema, c.req.raw);
        return c.json(await getRequestContext(c).services.cloud.createTemplate(body));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.delete(
    routePaths.v1.templateById(),
    describeRoute({
      tags: ["Cloud"],
      summary: "Delete a cloud template",
      description: "Deletes one active-organization template through Server V2.",
      responses: {
        200: jsonResponse("Cloud template deleted successfully.", cloudCompatErrorSchema),
        401: jsonResponse("Cloud signin is required to delete templates.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to delete the cloud template.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const templateId = c.req.param("templateId") ?? "";
        await getRequestContext(c).services.cloud.deleteTemplate(templateId);
        return c.json({ ok: true });
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.get(
    routePaths.v1.skills,
    describeRoute({
      tags: ["Cloud"],
      summary: "List cloud skills",
      description: "Returns the active-organization shared skill list through Server V2.",
      responses: {
        200: jsonResponse("Cloud skills returned successfully.", cloudOrgSkillListResponseSchema),
        401: jsonResponse("Cloud signin is required to list skills.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to list cloud skills.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        return c.json(await getRequestContext(c).services.cloud.listOrgSkills());
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.post(
    routePaths.v1.skills,
    describeRoute({
      tags: ["Cloud"],
      summary: "Create a cloud skill",
      description: "Creates an active-organization skill through Server V2.",
      responses: {
        200: jsonResponse("Cloud skill created successfully.", cloudOrgSkillCreateResponseSchema),
        400: jsonResponse("The skill creation payload was invalid.", cloudCompatErrorSchema),
        401: jsonResponse("Cloud signin is required to create skills.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to create the cloud skill.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const body = await parseJsonBody(cloudOrgSkillCreateRequestSchema, c.req.raw);
        return c.json(await getRequestContext(c).services.cloud.createOrgSkill(body));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.get(
    routePaths.v1.skillHubs,
    describeRoute({
      tags: ["Cloud"],
      summary: "List cloud skill hubs",
      description: "Returns the active-organization skill hubs through Server V2.",
      responses: {
        200: jsonResponse("Cloud skill hubs returned successfully.", cloudOrgSkillHubListResponseSchema),
        401: jsonResponse("Cloud signin is required to list skill hubs.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to list cloud skill hubs.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        return c.json(await getRequestContext(c).services.cloud.listOrgSkillHubs());
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.post(
    routePaths.v1.skillHubAddSkill(),
    describeRoute({
      tags: ["Cloud"],
      summary: "Add a skill to a cloud skill hub",
      description: "Adds an active-organization skill to one skill hub through Server V2.",
      responses: {
        200: jsonResponse("Cloud skill added to hub successfully.", cloudOrgSkillHubAddSkillResponseSchema),
        400: jsonResponse("The hub skill payload was invalid.", cloudCompatErrorSchema),
        401: jsonResponse("Cloud signin is required to mutate skill hubs.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to add the cloud skill to the hub.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const skillHubId = c.req.param("skillHubId") ?? "";
        const body = await parseJsonBody(cloudOrgSkillHubAddSkillRequestSchema, c.req.raw);
        return c.json(await getRequestContext(c).services.cloud.addOrgSkillToHub(skillHubId, body.skillId));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.get(
    routePaths.v1.me,
    describeRoute({
      tags: ["Cloud"],
      summary: "Get the current cloud user",
      description: "Returns the current cloud user and session using the server-owned cloud signin state.",
      responses: {
        200: jsonResponse("Current cloud user returned successfully.", cloudMeResponseSchema),
        401: jsonResponse("Cloud signin is required to read the current user.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to read the current cloud user.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        return c.json(await getRequestContext(c).services.cloud.getSession());
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.get(
    routePaths.v1.meOrgs,
    describeRoute({
      tags: ["Cloud"],
      summary: "List current cloud organizations",
      description: "Returns the current cloud organizations and active organization using the server-owned cloud signin state.",
      responses: {
        200: jsonResponse("Current cloud organizations returned successfully.", cloudOrganizationsResponseSchema),
        401: jsonResponse("Cloud signin is required to read organizations.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to read cloud organizations.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        return c.json(await getRequestContext(c).services.cloud.getOrganizations());
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.get(
    routePaths.v1.meDesktopConfig,
    describeRoute({
      tags: ["Cloud"],
      summary: "Get the current cloud desktop config",
      description: "Returns org-scoped desktop restrictions and allowed desktop versions through Server V2.",
      responses: {
        200: jsonResponse("Current cloud desktop config returned successfully.", cloudDesktopConfigSchema),
        401: jsonResponse("Cloud signin is required to read desktop config.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to read the current cloud desktop config.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        return c.json(await getRequestContext(c).services.cloud.getDesktopConfig());
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.post(
    routePaths.api.auth.organizationSetActive,
    describeRoute({
      tags: ["Cloud"],
      summary: "Set the active cloud organization",
      description: "Sets the active cloud organization through Server V2 and persists the resulting active-org metadata.",
      responses: {
        200: jsonResponse("Active cloud organization updated successfully.", cloudSetActiveOrganizationResponseSchema),
        400: jsonResponse("The active organization request body was invalid.", cloudCompatErrorSchema),
        401: jsonResponse("Cloud signin is required to change organizations.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to change the active organization.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const body = await parseJsonBody(cloudSetActiveOrganizationRequestSchema, c.req.raw);
        return c.json(await getRequestContext(c).services.cloud.setActiveOrganization(body));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.get(
    routePaths.workspaces.cloud.providerState(),
    describeRoute({
      tags: ["Cloud"],
      summary: "Read workspace cloud provider state",
      description: "Returns the server-owned imported cloud provider state and disabled provider list for one workspace.",
      responses: {
        200: jsonResponse("Workspace cloud provider state returned successfully.", workspaceCloudProviderStateResponseSchema),
        401: jsonResponse("Authentication is required to read workspace cloud provider state.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to read workspace cloud provider state.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const requestContext = getRequestContext(c);
        requestContext.services.auth.requireVisibleRead(requestContext.actor);
        const workspaceId = c.req.param("workspaceId") ?? "";
        return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.cloud.getWorkspaceCloudProviderState(workspaceId)));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.patch(
    routePaths.workspaces.configDisabledProviders(),
    describeRoute({
      tags: ["Cloud"],
      summary: "Set workspace disabled providers",
      description: "Persists the workspace disabled provider list through Server V2 instead of app-local config mutation.",
      responses: {
        200: jsonResponse("Workspace disabled providers updated successfully.", workspaceCloudProviderMutationResponseSchema),
        400: jsonResponse("The disabled provider payload was invalid.", cloudCompatErrorSchema),
        401: jsonResponse("Authentication is required to update disabled providers.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to update disabled providers.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const requestContext = getRequestContext(c);
        requestContext.services.auth.requireVisibleRead(requestContext.actor);
        const body = await parseJsonBody(workspaceDisabledProvidersWriteSchema, c.req.raw);
        const workspaceId = c.req.param("workspaceId") ?? "";
        return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.cloud.setWorkspaceDisabledProviders(workspaceId, body.disabledProviders)));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.put(
    routePaths.workspaces.cloud.providerImport(),
    describeRoute({
      tags: ["Cloud"],
      summary: "Import one cloud LLM provider into a workspace",
      description: "Creates or updates one workspace-scoped cloud-managed provider config and persists its import state through Server V2.",
      responses: {
        200: jsonResponse("Workspace cloud provider imported successfully.", workspaceCloudProviderMutationResponseSchema),
        401: jsonResponse("Authentication is required to import a cloud provider.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to import the cloud provider.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const requestContext = getRequestContext(c);
        requestContext.services.auth.requireVisibleRead(requestContext.actor);
        const workspaceId = c.req.param("workspaceId") ?? "";
        const cloudProviderId = c.req.param("cloudProviderId") ?? "";
        return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.cloud.importWorkspaceCloudProvider(workspaceId, cloudProviderId)));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.delete(
    routePaths.workspaces.cloud.providerImport(),
    describeRoute({
      tags: ["Cloud"],
      summary: "Remove one imported cloud LLM provider from a workspace",
      description: "Removes one workspace-scoped cloud-managed provider config and clears its persisted import state through Server V2.",
      responses: {
        200: jsonResponse("Workspace cloud provider removed successfully.", workspaceCloudProviderMutationResponseSchema),
        401: jsonResponse("Authentication is required to remove a cloud provider.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to remove the cloud provider.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const requestContext = getRequestContext(c);
        requestContext.services.auth.requireVisibleRead(requestContext.actor);
        const workspaceId = c.req.param("workspaceId") ?? "";
        const cloudProviderId = c.req.param("cloudProviderId") ?? "";
        return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.cloud.removeWorkspaceCloudProvider(workspaceId, cloudProviderId)));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );

  app.post(
    routePaths.workspaces.cloud.providerSync(),
    describeRoute({
      tags: ["Cloud"],
      summary: "Sync workspace cloud LLM providers",
      description: "Reconciles workspace cloud-managed provider config with the currently visible cloud organization provider catalog through Server V2.",
      responses: {
        200: jsonResponse("Workspace cloud providers synced successfully.", workspaceCloudProviderSyncResponseSchema),
        401: jsonResponse("Authentication is required to sync cloud providers.", cloudCompatErrorSchema),
        500: jsonResponse("The server failed to sync cloud providers.", cloudCompatErrorSchema),
      },
    }),
    async (c) => {
      try {
        const requestContext = getRequestContext(c);
        requestContext.services.auth.requireVisibleRead(requestContext.actor);
        const workspaceId = c.req.param("workspaceId") ?? "";
        return c.json(buildSuccessResponse(requestContext.requestId, await requestContext.services.cloud.syncWorkspaceCloudProviders(workspaceId)));
      } catch (error) {
        return respondWithCompatError(c, error);
      }
    },
  );
}
