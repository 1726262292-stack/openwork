import { z } from "zod";
import { successResponseSchema } from "./common.js";

const nullableString = z.string().nullable();

export const cloudCompatErrorSchema = z.object({
  error: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
}).meta({ ref: "OpenWorkServerV2CloudCompatError" });

export const cloudUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  name: nullableString.optional(),
}).passthrough().meta({ ref: "OpenWorkServerV2CloudUser" });

export const cloudSessionSchema = z.object({}).passthrough().meta({ ref: "OpenWorkServerV2CloudSession" });

export const cloudMeResponseSchema = z.object({
  user: cloudUserSchema,
  session: cloudSessionSchema,
}).passthrough().meta({ ref: "OpenWorkServerV2CloudMeResponse" });

export const cloudAppVersionResponseSchema = z.object({
  minAppVersion: z.string(),
  latestAppVersion: z.string().min(1),
}).meta({ ref: "OpenWorkServerV2CloudAppVersionResponse" });

export const cloudDesktopConfigSchema = z.object({
  disallowNonCloudModels: z.boolean().optional(),
  blockZenModel: z.boolean().optional(),
  blockMultipleWorkspaces: z.boolean().optional(),
  allowedDesktopVersions: z.array(z.string().trim().min(1).max(32)).optional(),
}).meta({ ref: "OpenWorkServerV2CloudDesktopConfig" });

export const cloudDesktopHandoffExchangeRequestSchema = z.object({
  grant: z.string().trim().min(1),
}).meta({ ref: "OpenWorkServerV2CloudDesktopHandoffExchangeRequest" });

export const cloudDesktopHandoffExchangeResponseSchema = z.object({
  user: cloudUserSchema.nullable(),
  token: nullableString,
}).passthrough().meta({ ref: "OpenWorkServerV2CloudDesktopHandoffExchangeResponse" });

export const cloudOrganizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  role: z.enum(["owner", "admin", "member"]).optional(),
  isActive: z.boolean().optional(),
}).passthrough().meta({ ref: "OpenWorkServerV2CloudOrganization" });

export const cloudOrganizationsResponseSchema = z.object({
  orgs: z.array(cloudOrganizationSchema),
  activeOrgId: nullableString,
  activeOrgSlug: nullableString,
}).passthrough().meta({ ref: "OpenWorkServerV2CloudOrganizationsResponse" });

export const cloudSetActiveOrganizationRequestSchema = z.object({
  organizationId: nullableString.optional(),
  organizationSlug: nullableString.optional(),
}).refine(
  (value) => Boolean(value.organizationId?.trim() || value.organizationSlug?.trim()),
  {
    error: "organizationId or organizationSlug is required.",
    path: ["organizationId"],
  },
).meta({ ref: "OpenWorkServerV2CloudSetActiveOrganizationRequest" });

export const cloudSetActiveOrganizationResponseSchema = z.object({
  ok: z.literal(true),
  activeOrgId: nullableString,
  activeOrgSlug: nullableString,
}).meta({ ref: "OpenWorkServerV2CloudSetActiveOrganizationResponse" });

export const cloudBootstrapConfigSchema = z.object({
  apiBaseUrl: z.string().min(1),
  baseUrl: z.string().min(1),
  requireSignin: z.boolean(),
}).meta({ ref: "OpenWorkServerV2CloudBootstrapConfig" });

export const cloudBootstrapConfigResponseSchema = successResponseSchema(
  "OpenWorkServerV2CloudBootstrapConfigResponse",
  cloudBootstrapConfigSchema,
);

export const cloudLlmProviderModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  createdAt: nullableString.optional(),
}).meta({ ref: "OpenWorkServerV2CloudLlmProviderModel" });

export const cloudLlmProviderSchema = z.object({
  id: z.string().min(1),
  source: z.enum(["models_dev", "custom"]),
  providerId: z.string().min(1),
  name: z.string().min(1),
  providerConfig: z.record(z.string(), z.unknown()),
  hasApiKey: z.boolean(),
  models: z.array(cloudLlmProviderModelSchema),
  createdAt: nullableString,
  updatedAt: nullableString,
}).meta({ ref: "OpenWorkServerV2CloudLlmProvider" });

export const cloudLlmProviderConnectionSchema = cloudLlmProviderSchema.extend({
  apiKey: nullableString,
}).meta({ ref: "OpenWorkServerV2CloudLlmProviderConnection" });

export const cloudLlmProviderListResponseSchema = z.object({
  llmProviders: z.array(cloudLlmProviderSchema),
}).meta({ ref: "OpenWorkServerV2CloudLlmProviderListResponse" });

export const cloudLlmProviderConnectionResponseSchema = z.object({
  llmProvider: cloudLlmProviderConnectionSchema,
}).meta({ ref: "OpenWorkServerV2CloudLlmProviderConnectionResponse" });

export const cloudWorkerSummarySchema = z.object({
  workerId: z.string().min(1),
  workerName: z.string().min(1),
  status: z.string().min(1),
  instanceUrl: nullableString,
  provider: nullableString,
  isMine: z.boolean(),
  createdAt: nullableString,
}).meta({ ref: "OpenWorkServerV2CloudWorkerSummary" });

export const cloudWorkerListResponseSchema = z.object({
  workers: z.array(cloudWorkerSummarySchema),
}).meta({ ref: "OpenWorkServerV2CloudWorkerListResponse" });

export const cloudWorkerTokensResponseSchema = z.object({
  tokens: z.object({
    client: nullableString,
    owner: nullableString,
    host: nullableString,
  }).passthrough(),
  connect: z.object({
    openworkUrl: nullableString.optional(),
    workspaceId: nullableString.optional(),
  }).passthrough().optional(),
}).passthrough().meta({ ref: "OpenWorkServerV2CloudWorkerTokensResponse" });

export const cloudTemplateCreatorSchema = z.object({
  memberId: z.string().min(1),
  role: z.enum(["owner", "admin", "member"]),
  userId: z.string().min(1),
  name: nullableString,
  email: nullableString,
  image: nullableString,
}).meta({ ref: "OpenWorkServerV2CloudTemplateCreator" });

export const cloudTemplateSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1),
  templateData: z.unknown(),
  createdAt: nullableString,
  updatedAt: nullableString,
  creator: cloudTemplateCreatorSchema.nullable(),
}).meta({ ref: "OpenWorkServerV2CloudTemplate" });

export const cloudTemplateListResponseSchema = z.object({
  templates: z.array(cloudTemplateSchema),
}).meta({ ref: "OpenWorkServerV2CloudTemplateListResponse" });

export const cloudTemplateResponseSchema = z.object({
  template: cloudTemplateSchema,
}).meta({ ref: "OpenWorkServerV2CloudTemplateResponse" });

export const cloudTemplateCreateRequestSchema = z.object({
  name: z.string().trim().min(1),
  templateData: z.unknown(),
}).meta({ ref: "OpenWorkServerV2CloudTemplateCreateRequest" });

export const cloudOrgSkillSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: nullableString,
  skillText: z.string().min(1),
  hubName: nullableString.optional(),
  shared: z.enum(["org", "public"]).nullable(),
  updatedAt: nullableString,
}).meta({ ref: "OpenWorkServerV2CloudOrgSkill" });

export const cloudOrgSkillListResponseSchema = z.object({
  skills: z.array(cloudOrgSkillSchema),
}).meta({ ref: "OpenWorkServerV2CloudOrgSkillListResponse" });

export const cloudOrgSkillHubSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  skills: z.array(cloudOrgSkillSchema),
}).meta({ ref: "OpenWorkServerV2CloudOrgSkillHub" });

export const cloudOrgSkillHubListResponseSchema = z.object({
  skillHubs: z.array(cloudOrgSkillHubSchema),
}).meta({ ref: "OpenWorkServerV2CloudOrgSkillHubListResponse" });

export const cloudOrgSkillCreateRequestSchema = z.object({
  skillText: z.string().min(1),
  shared: z.enum(["org", "public"]).nullable().optional(),
}).meta({ ref: "OpenWorkServerV2CloudOrgSkillCreateRequest" });

export const cloudOrgSkillCreateResponseSchema = z.object({
  id: z.string().min(1),
}).passthrough().meta({ ref: "OpenWorkServerV2CloudOrgSkillCreateResponse" });

export const cloudOrgSkillHubAddSkillRequestSchema = z.object({
  skillId: z.string().trim().min(1),
}).meta({ ref: "OpenWorkServerV2CloudOrgSkillHubAddSkillRequest" });

export const cloudOrgSkillHubAddSkillResponseSchema = z.object({}).passthrough().meta({ ref: "OpenWorkServerV2CloudOrgSkillHubAddSkillResponse" });

export const workspaceImportedCloudProviderSchema = z.object({
  cloudProviderId: z.string().min(1),
  providerId: z.string().min(1),
  sourceProviderId: z.string().min(1),
  name: z.string().min(1),
  source: nullableString,
  updatedAt: nullableString,
  modelIds: z.array(z.string().min(1)),
  importedAt: z.number().int().nonnegative().nullable(),
}).meta({ ref: "OpenWorkServerV2WorkspaceImportedCloudProvider" });

export const workspaceCloudProviderStateDataSchema = z.object({
  disabledProviders: z.array(z.string().min(1)),
  importedProviders: z.record(z.string(), workspaceImportedCloudProviderSchema),
}).meta({ ref: "OpenWorkServerV2WorkspaceCloudProviderStateData" });

export const workspaceCloudProviderStateResponseSchema = successResponseSchema(
  "OpenWorkServerV2WorkspaceCloudProviderStateResponse",
  workspaceCloudProviderStateDataSchema,
);

export const workspaceCloudProviderMutationDataSchema = z.object({
  disabledProviders: z.array(z.string().min(1)),
  importedProviders: z.record(z.string(), workspaceImportedCloudProviderSchema),
  snapshot: z.object({
    effective: z.object({
      opencode: z.record(z.string(), z.unknown()),
      openwork: z.record(z.string(), z.unknown()),
    }),
    stored: z.object({
      opencode: z.record(z.string(), z.unknown()),
      openwork: z.record(z.string(), z.unknown()),
    }),
    materialized: z.object({
      compatibilityOpencodePath: nullableString,
      compatibilityOpenworkPath: nullableString,
      configDir: nullableString,
      configOpencodePath: nullableString,
      configOpenworkPath: nullableString,
    }),
    updatedAt: z.string(),
    workspaceId: z.string().min(1),
  }),
}).meta({ ref: "OpenWorkServerV2WorkspaceCloudProviderMutationData" });

export const workspaceCloudProviderMutationResponseSchema = successResponseSchema(
  "OpenWorkServerV2WorkspaceCloudProviderMutationResponse",
  workspaceCloudProviderMutationDataSchema,
);

export const workspaceCloudProviderImportRequestSchema = z.object({
  cloudProviderId: z.string().trim().min(1).optional(),
}).meta({ ref: "OpenWorkServerV2WorkspaceCloudProviderImportRequest" });

export const workspaceDisabledProvidersWriteSchema = z.object({
  disabledProviders: z.array(z.string().trim().min(1)),
}).meta({ ref: "OpenWorkServerV2WorkspaceDisabledProvidersWrite" });

export const workspaceCloudProviderSyncDataSchema = workspaceCloudProviderMutationDataSchema.extend({
  added: z.array(z.string().min(1)),
  removed: z.array(z.string().min(1)),
  updated: z.array(z.string().min(1)),
}).meta({ ref: "OpenWorkServerV2WorkspaceCloudProviderSyncData" });

export const workspaceCloudProviderSyncResponseSchema = successResponseSchema(
  "OpenWorkServerV2WorkspaceCloudProviderSyncResponse",
  workspaceCloudProviderSyncDataSchema,
);

export type CloudAppVersionResponse = z.infer<typeof cloudAppVersionResponseSchema>;
export type CloudDesktopConfig = z.infer<typeof cloudDesktopConfigSchema>;
export type CloudDesktopHandoffExchangeResponse = z.infer<typeof cloudDesktopHandoffExchangeResponseSchema>;
export type CloudLlmProvider = z.infer<typeof cloudLlmProviderSchema>;
export type CloudLlmProviderConnection = z.infer<typeof cloudLlmProviderConnectionSchema>;
export type CloudMeResponse = z.infer<typeof cloudMeResponseSchema>;
export type CloudOrganizationsResponse = z.infer<typeof cloudOrganizationsResponseSchema>;
export type WorkspaceImportedCloudProvider = z.infer<typeof workspaceImportedCloudProviderSchema>;
