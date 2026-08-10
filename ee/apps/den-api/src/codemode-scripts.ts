import { and, desc, eq, gt, isNull } from "@openwork-ee/den-db/drizzle"
import {
  CodemodeRunTable,
  ConfigObjectAccessGrantTable,
  ConfigObjectTable,
  ConfigObjectVersionTable,
  PluginAccessGrantTable,
  PluginConfigObjectTable,
  PluginTable,
} from "@openwork-ee/den-db/schema"
import { createDenTypeId, normalizeDenTypeId, type DenTypeId } from "@openwork-ee/utils/typeid"
import { codemodeCodeDigest } from "./codemode-runs.js"
import { db } from "./db.js"
import { parseCodemodeScriptPayload, validateCodemodeScriptInput } from "./mcp/codemode-script-object.js"
import type { BuiltCodemodeTools } from "./mcp/codemode-tools.js"

const SAVED_SCRIPTS_PLUGIN_NAME = "Saved scripts"
const RECENT_RUN_WINDOW_MS = 15 * 60_000

export type SaveCodemodeScriptInput = {
  name: string
  description?: string
  code: string
  currentInput?: unknown
  inputSchema?: unknown
  outputSchema?: unknown
}

export async function saveCodemodeScript(input: {
  organizationId: string
  ownerMemberId: string
  script: SaveCodemodeScriptInput
  buildTools: () => Promise<BuiltCodemodeTools>
}): Promise<{ pluginId: string; configObjectId: string; configObjectVersionId: string }> {
  const organizationId = normalizeDenTypeId("organization", input.organizationId)
  const ownerMemberId = normalizeDenTypeId("member", input.ownerMemberId)
  const receipts = await db.select().from(CodemodeRunTable).where(and(
    eq(CodemodeRunTable.organization_id, organizationId),
    eq(CodemodeRunTable.org_membership_id, ownerMemberId),
    eq(CodemodeRunTable.code_digest, codemodeCodeDigest(input.script.code)),
    eq(CodemodeRunTable.status, "succeeded"),
    gt(CodemodeRunTable.finished_at, new Date(Date.now() - RECENT_RUN_WINDOW_MS)),
  )).orderBy(desc(CodemodeRunTable.finished_at)).limit(1)
  const receipt = receipts[0]
  if (!receipt) throw new Error("saved_script_recent_receipt_required")

  const built = await input.buildTools()
  const manifestByPath = new Map(built.manifest.flatMap((entry) => [
    [entry.scriptPath, entry] as const,
    [entry.scriptPath.replace(/^tools\./, ""), entry] as const,
  ]))
  const requiredCapabilities: Array<{ capabilityName: string; scriptPath: string }> = []
  for (const call of receipt.tool_calls ?? []) {
    const resolved = manifestByPath.get(call.name)
    if (!resolved) throw new Error(`saved_script_capability_unavailable:${call.name}`)
    if (resolved.readOnly !== true) throw new Error(`saved_script_requires_read_only_capabilities:${call.name}`)
    if (!requiredCapabilities.some((entry) => entry.scriptPath === resolved.scriptPath)) {
      requiredCapabilities.push({
        capabilityName: resolved.capabilityName,
        scriptPath: resolved.scriptPath,
      })
    }
  }
  const normalizedPayloadJson = {
    language: "codemode-js",
    ...(input.script.inputSchema === undefined ? {} : { inputSchema: input.script.inputSchema }),
    ...(input.script.outputSchema === undefined ? {} : { outputSchema: input.script.outputSchema }),
    requiredCapabilities,
  }
  const parsed = parseCodemodeScriptPayload(normalizedPayloadJson)
  if (!parsed.ok) throw new Error(`saved_script_invalid_schema:${parsed.message}`)
  if (parsed.payload.inputSchema) {
    const validation = validateCodemodeScriptInput(parsed.payload.inputSchema, input.script.currentInput)
    if (!validation.ok) throw new Error("saved_script_current_input_invalid")
  }

  return db.transaction(async (tx) => {
    const plugins = await tx.select().from(PluginTable).where(and(
      eq(PluginTable.organizationId, organizationId),
      eq(PluginTable.createdByOrgMembershipId, ownerMemberId),
      eq(PluginTable.name, SAVED_SCRIPTS_PLUGIN_NAME),
      eq(PluginTable.status, "active"),
      isNull(PluginTable.deletedAt),
    )).limit(1).for("update")
    const pluginId = plugins[0]?.id ?? createDenTypeId("plugin")
    if (!plugins[0]) {
      await tx.insert(PluginTable).values({
        id: pluginId,
        organizationId,
        name: SAVED_SCRIPTS_PLUGIN_NAME,
        description: "Private reusable Code Mode scripts.",
        status: "active",
        createdByOrgMembershipId: ownerMemberId,
      })
      await tx.insert(PluginAccessGrantTable).values({
        id: createDenTypeId("pluginAccessGrant"),
        organizationId,
        pluginId,
        orgMembershipId: ownerMemberId,
        teamId: null,
        orgWide: false,
        role: "manager",
        createdByOrgMembershipId: ownerMemberId,
      })
    }

    const linked = await tx.select({ object: ConfigObjectTable }).from(PluginConfigObjectTable)
      .innerJoin(ConfigObjectTable, eq(ConfigObjectTable.id, PluginConfigObjectTable.configObjectId))
      .where(and(
        eq(PluginConfigObjectTable.pluginId, pluginId),
        isNull(PluginConfigObjectTable.removedAt),
        eq(ConfigObjectTable.title, input.script.name),
        eq(ConfigObjectTable.objectType, "script"),
        eq(ConfigObjectTable.status, "active"),
        isNull(ConfigObjectTable.deletedAt),
      )).limit(1).for("update")
    const configObjectId = linked[0]?.object.id ?? createDenTypeId("configObject")
    if (!linked[0]) {
      await tx.insert(ConfigObjectTable).values({
        id: configObjectId,
        organizationId,
        objectType: "script",
        sourceMode: "cloud",
        title: input.script.name,
        description: input.script.description?.trim() || null,
        searchText: `${input.script.name} ${input.script.description ?? ""}`.trim(),
        currentFileName: `${input.script.name}.js`,
        currentFileExtension: "js",
        status: "active",
        createdByOrgMembershipId: ownerMemberId,
      })
      await tx.insert(PluginConfigObjectTable).values({
        id: createDenTypeId("pluginConfigObject"),
        organizationId,
        pluginId,
        configObjectId,
        membershipSource: "manual",
        createdByOrgMembershipId: ownerMemberId,
      })
      await tx.insert(ConfigObjectAccessGrantTable).values({
        id: createDenTypeId("configObjectAccessGrant"),
        organizationId,
        configObjectId,
        orgMembershipId: ownerMemberId,
        teamId: null,
        orgWide: false,
        role: "manager",
        createdByOrgMembershipId: ownerMemberId,
      })
    }
    const configObjectVersionId: DenTypeId<"configObjectVersion"> = createDenTypeId("configObjectVersion")
    await tx.insert(ConfigObjectVersionTable).values({
      id: configObjectVersionId,
      organizationId,
      configObjectId,
      normalizedPayloadJson,
      rawSourceText: input.script.code,
      schemaVersion: "codemode-script-v1",
      createdVia: "cloud",
      createdByOrgMembershipId: ownerMemberId,
      sourceRevisionRef: receipt.code_digest,
      isDeletedVersion: false,
    })
    return { pluginId, configObjectId, configObjectVersionId }
  })
}
