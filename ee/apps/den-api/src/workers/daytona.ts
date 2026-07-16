import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { eq } from "@openwork-ee/den-db/drizzle"
import { DaytonaSandboxTable } from "@openwork-ee/den-db/schema"
import { createDenTypeId } from "@openwork-ee/utils/typeid"
import { db } from "../db.js"
import { env } from "../env.js"
import { appLogger } from "../observability/logger.js"
import {
  buildDaytonaWorkerRuntimeEnv,
  daytonaWorkerAutostartMarkerPath,
  daytonaWorkerStartupLogPath,
  daytonaWorkerStartupScriptPath,
  type DaytonaWorkerRuntimeEnv,
} from "./daytona-runtime-env.js"

type WorkerId = typeof DaytonaSandboxTable.$inferSelect.worker_id

type ProvisionInput = {
  workerId: WorkerId
  name: string
  hostToken: string
  clientToken: string
  activityToken: string
}

type ProvisionedInstance = {
  provider: string
  url: string
  status: "provisioning" | "healthy"
  region?: string
}

type DaytonaSandboxListPage = {
  items: Array<{ id?: unknown }>
  nextCursor?: string | null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const maxSignedPreviewExpirySeconds = 60 * 60 * 24
const signedPreviewRefreshLeadMs = 5 * 60 * 1000
const logger = appLogger.child({ component: "daytona_provisioner" })

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function createDaytonaClient() {
  return new Daytona({
    apiKey: env.daytona.apiKey,
    apiUrl: env.daytona.apiUrl,
    ...(env.daytona.target ? { target: env.daytona.target } : {}),
  })
}

function daytonaApiUrl(path: string) {
  return `${env.daytona.apiUrl.replace(/\/+$/, "")}${path}`
}

function readDaytonaSandboxListPage(value: unknown): DaytonaSandboxListPage {
  if (Array.isArray(value)) {
    return { items: value as Array<{ id?: unknown }> }
  }

  if (!value || typeof value !== "object") {
    return { items: [] }
  }

  const page = value as Record<string, unknown>
  const items = Array.isArray(page.items)
    ? page.items
    : Array.isArray(page.data)
      ? page.data
      : Array.isArray(page.sandboxes)
        ? page.sandboxes
        : []
  const nextCursor = typeof page.nextCursor === "string"
    ? page.nextCursor
    : typeof page.next_cursor === "string"
      ? page.next_cursor
      : null

  return { items: items as Array<{ id?: unknown }>, nextCursor }
}

async function listDaytonaSandboxIdsByLabels(labels: Record<string, string>) {
  const ids: string[] = []
  let cursor: string | undefined

  do {
    const url = new URL(daytonaApiUrl("/sandbox"))
    url.searchParams.set("limit", "100")
    url.searchParams.set("labels", JSON.stringify(labels))
    if (cursor) {
      url.searchParams.set("cursor", cursor)
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.daytona.apiKey}`,
        "X-Daytona-Source": "openwork-den-api",
      },
    })

    if (!response.ok) {
      throw new Error(`Daytona sandbox list failed with ${response.status}`)
    }

    const page = readDaytonaSandboxListPage(await response.json())
    for (const sandbox of page.items) {
      if (typeof sandbox.id === "string") {
        ids.push(sandbox.id)
      }
    }

    cursor = page.nextCursor ?? undefined
  } while (cursor)

  return ids
}

function normalizedSignedPreviewExpirySeconds() {
  return Math.max(
    1,
    Math.min(env.daytona.signedPreviewExpiresSeconds, maxSignedPreviewExpirySeconds),
  )
}

function signedPreviewRefreshAt(expiresInSeconds: number) {
  return new Date(
    Date.now() + Math.max(0, expiresInSeconds * 1000 - signedPreviewRefreshLeadMs),
  )
}

function workerProxyUrl(workerId: WorkerId) {
  return `${env.daytona.workerProxyBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(workerId)}`
}

function workerActivityHeartbeatUrl(workerId: WorkerId) {
  const base = env.workerActivityBaseUrl.replace(/\/+$/, "")
  return `${base}/v1/workers/${encodeURIComponent(workerId)}/activity-heartbeat`
}

function assertDaytonaConfig() {
  if (!env.daytona.apiKey) {
    throw new Error("DAYTONA_API_KEY is required for daytona provisioner")
  }
}

function workerHint(workerId: WorkerId) {
  return workerId.replace(/-/g, "").slice(0, 12)
}

function sandboxLabels(workerId: WorkerId) {
  return {
    "openwork.den.provider": "daytona",
    "openwork.den.worker-id": workerId,
  }
}

function sandboxName(input: ProvisionInput) {
  return slug(
    `${env.daytona.sandboxNamePrefix}-${input.name}-${workerHint(input.workerId)}`,
  ).slice(0, 63)
}

function sharedVolumeName() {
  return slug(env.daytona.sharedVolumeName).slice(0, 63)
}

function workerVolumeRootSubpath(workerId: WorkerId) {
  return `workers/${workerId}`
}

function workspaceVolumeSubpath(workerId: WorkerId) {
  return `${workerVolumeRootSubpath(workerId)}/workspace`
}

function dataVolumeSubpath(workerId: WorkerId) {
  return `${workerVolumeRootSubpath(workerId)}/data`
}

function sharedVolumeMounts(workerId: WorkerId, volumeId: string) {
  return [
    {
      volumeId,
      mountPath: env.daytona.workspaceMountPath,
      subpath: workspaceVolumeSubpath(workerId),
    },
    {
      volumeId,
      mountPath: env.daytona.dataMountPath,
      subpath: dataVolumeSubpath(workerId),
    },
  ]
}

function buildOpenWorkStartCommand() {
  const verifyRuntimeStep = [
    "if ! command -v openwork >/dev/null 2>&1; then echo 'openwork binary missing from Daytona runtime image; rebuild and republish the Daytona snapshot' >&2; exit 1; fi",
    "if ! command -v opencode >/dev/null 2>&1; then echo 'opencode binary missing from Daytona runtime image; rebuild and republish the Daytona snapshot' >&2; exit 1; fi",
  ].join("; ")
  const requiredRuntimeEnvStep = `
require_env() {
  name="$1"
  if value="$(printenv "$name")"; then
    :
  else
    value=""
  fi
  if [ -z "$value" ]; then
    echo "$name is required when DEN_WORKER_ID is set" >&2
    exit 1
  fi
}
require_number_env() {
  require_env "$1"
  case "$value" in
    *[!0-9]*) echo "$name must be numeric" >&2; exit 1 ;;
  esac
}
for name in DEN_RUNTIME_PROVIDER DEN_WORKER_ID DEN_ACTIVITY_HEARTBEAT_ENABLED DEN_ACTIVITY_HEARTBEAT_URL DEN_ACTIVITY_HEARTBEAT_TOKEN OPENWORK_TOKEN OPENWORK_HOST_TOKEN OPENWORK_DATA_DIR OPENWORK_SIDECAR_DIR OPENWORK_WORKSPACE OPENWORK_OPENCODE_HOST OPENWORK_CONNECT_HOST OPENWORK_CORS OPENWORK_APPROVAL OPENWORK_OPENCODE_SOURCE DAYTONA_WORKSPACE_MOUNT_PATH DAYTONA_DATA_MOUNT_PATH; do
  require_env "$name"
done
require_number_env OPENWORK_PORT
require_number_env OPENWORK_OPENCODE_PORT
`.trim()
  const openworkServe = [
    "openwork serve",
    ` --workspace "$OPENWORK_WORKSPACE"`,
    ` --remote-access`,
    ` --openwork-port "$OPENWORK_PORT"`,
    ` --opencode-host "$OPENWORK_OPENCODE_HOST"`,
    ` --opencode-port "$OPENWORK_OPENCODE_PORT"`,
    ` --connect-host "$OPENWORK_CONNECT_HOST"`,
    ` --cors "$OPENWORK_CORS"`,
    ` --approval "$OPENWORK_APPROVAL"`,
    ` --allow-external`,
    ` --opencode-source "$OPENWORK_OPENCODE_SOURCE"`,
    ` --opencode-bin "$opencode_bin"`,
    ` --verbose`,
  ].join("")

  const script = `
set -u
${requiredRuntimeEnvStep}
mkdir -p "$DAYTONA_WORKSPACE_MOUNT_PATH" "$DAYTONA_DATA_MOUNT_PATH" "$OPENWORK_WORKSPACE" "$OPENWORK_DATA_DIR" "$OPENWORK_SIDECAR_DIR" "$OPENWORK_WORKSPACE/volumes"
ln -sfn "$DAYTONA_WORKSPACE_MOUNT_PATH" "$OPENWORK_WORKSPACE/volumes/workspace"
ln -sfn "$DAYTONA_DATA_MOUNT_PATH" "$OPENWORK_WORKSPACE/volumes/data"
${verifyRuntimeStep}
opencode_bin="$(command -v opencode)"
attempt=0
while [ "$attempt" -lt 3 ]; do
  attempt=$((attempt + 1))
  if ${openworkServe}; then
    exit 0
  else
    status=$?
  fi
  echo "openwork serve failed (attempt $attempt, exit $status); retrying in 3s"
  sleep 3
done
exit 1
`.trim()

  return `sh -lc ${shellQuote(script)}`
}

async function waitForVolumeReady(daytona: Daytona, name: string, timeoutMs: number) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const volume = await daytona.volume.get(name)
    if (volume.state === "ready") {
      return volume
    }
    await sleep(env.daytona.pollIntervalMs)
  }

  throw new Error(`Timed out waiting for Daytona volume ${name} to become ready`)
}

function buildVolumeCleanupCommand(workerId: WorkerId) {
  return [
    "node -e",
    shellQuote(
      [
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'for (const dir of process.argv.slice(1)) {',
        '  fs.mkdirSync(dir, { recursive: true })',
        '  for (const entry of fs.readdirSync(dir)) {',
        '    fs.rmSync(path.join(dir, entry), { recursive: true, force: true })',
        '  }',
        '}',
      ].join("; "),
    ),
    shellQuote(env.daytona.workspaceMountPath),
    shellQuote(env.daytona.dataMountPath),
  ].join(" ")
}

async function cleanupWorkerDataOnDaytona(daytona: Daytona, workerId: WorkerId) {
  let sharedVolume

  try {
    sharedVolume = await waitForVolumeReady(
      daytona,
      sharedVolumeName(),
      env.daytona.createTimeoutSeconds * 1000,
    )
  } catch (error) {
    logger.warn("failed to resolve shared Daytona volume", { worker_id: workerId, error })
    return
  }

  let cleanupSandbox: Awaited<ReturnType<typeof daytona.create>> | null = null

  try {
    cleanupSandbox = await daytona.create(
      {
        name: slug(`den-daytona-cleanup-${workerHint(workerId)}`).slice(0, 63),
        image: env.daytona.image,
        public: false,
        autoStopInterval: 0,
        autoArchiveInterval: 0,
        autoDeleteInterval: 0,
        ephemeral: true,
        envVars: {
          DEN_RUNTIME_PROVIDER: "daytona-cleanup",
          DEN_WORKER_ID: workerId,
        },
        resources: {
          cpu: 1,
          memory: 1,
          disk: 4,
        },
        volumes: sharedVolumeMounts(workerId, sharedVolume.id),
      },
      { timeout: env.daytona.createTimeoutSeconds },
    )

    const result = await cleanupSandbox.process.executeCommand(
      buildVolumeCleanupCommand(workerId),
      undefined,
      undefined,
      env.daytona.deleteTimeoutSeconds,
    )

    if (result.exitCode !== 0) {
      throw new Error(result.result?.trim() || `cleanup command exited with ${result.exitCode}`)
    }
  } catch (error) {
    logger.warn("failed to cleanup Daytona worker data", { worker_id: workerId, error })
  } finally {
    if (cleanupSandbox) {
      await cleanupSandbox.delete(env.daytona.deleteTimeoutSeconds).catch((error) => {
        logger.warn("failed to delete Daytona cleanup sandbox", { worker_id: workerId, error })
      })
    }
  }
}

type HealthWaitMode =
  | { kind: "container-startup" }
  | { kind: "legacy-session"; sessionId: string; commandId: string }

const maxHealthProbeRequestMs = 10_000

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function fetchHealthWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { method: "GET", signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function throwIfLegacySessionExited(sandbox: Sandbox, mode: HealthWaitMode) {
  if (mode.kind !== "legacy-session") {
    return
  }

  try {
    const command = await sandbox.process.getSessionCommand(mode.sessionId, mode.commandId)
    if (typeof command.exitCode === "number" && command.exitCode !== 0) {
      const logs = await sandbox.process.getSessionCommandLogs(mode.sessionId, mode.commandId)
      throw new Error(
        [
          `openwork session exited with ${command.exitCode}`,
          logs.stdout?.trim() ? `stdout:\n${logs.stdout.trim().slice(-4000)}` : "",
          logs.stderr?.trim() ? `stderr:\n${logs.stderr.trim().slice(-4000)}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("openwork session exited")) {
      throw error
    }
  }
}

async function legacySessionLogs(sandbox: Sandbox, mode: HealthWaitMode) {
  if (mode.kind !== "legacy-session") {
    return null
  }

  return await sandbox.process.getSessionCommandLogs(mode.sessionId, mode.commandId).catch(
    () => null,
  )
}

async function containerStartupDiagnostics(sandbox: Sandbox) {
  const scriptCheck = await sandbox.process.executeCommand(
    `test -x ${shellQuote(daytonaWorkerStartupScriptPath)} && echo 'startup script present' || echo 'startup script missing'`,
    undefined,
    undefined,
    10,
  ).catch(() => null)
  const startupLogTail = await sandbox.process.executeCommand(
    [
      "node -e",
      shellQuote(
        [
          'const fs = require("node:fs")',
          'const path = process.argv[1]',
          'if (!fs.existsSync(path)) { console.log(`startup log missing: ${path}`); process.exit(0) }',
          'const text = fs.readFileSync(path, "utf8")',
          'process.stdout.write(text.slice(-4000))',
        ].join("; "),
      ),
      shellQuote(daytonaWorkerStartupLogPath),
    ].join(" "),
    undefined,
    undefined,
    10,
  ).catch(() => null)

  return [
    scriptCheck?.result?.trim() ? `startup script check:\n${scriptCheck.result.trim().slice(-4000)}` : "",
    startupLogTail?.result?.trim() ? `startup log tail (${daytonaWorkerStartupLogPath}):\n${startupLogTail.result.trim().slice(-4000)}` : "",
  ].filter(Boolean)
}

async function waitForHealth(url: string, timeoutMs: number, sandbox: Sandbox, mode: HealthWaitMode) {
  const startedAt = Date.now()
  const healthUrl = `${url.replace(/\/$/, "")}/health`
  let lastProbe = "no health probe completed"

  while (Date.now() - startedAt < timeoutMs) {
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt))
    const requestTimeoutMs = Math.min(maxHealthProbeRequestMs, remainingMs)
    try {
      const response = await fetchHealthWithTimeout(healthUrl, requestTimeoutMs)
      if (response.ok) {
        return
      }
      lastProbe = `health returned HTTP ${response.status}`
    } catch (error) {
      lastProbe = `health probe failed or timed out after ${requestTimeoutMs}ms: ${errorMessage(error)}`
    }

    await throwIfLegacySessionExited(sandbox, mode)

    await sleep(Math.min(env.daytona.pollIntervalMs, Math.max(0, timeoutMs - (Date.now() - startedAt))))
  }

  const logs = await legacySessionLogs(sandbox, mode)
  const diagnostics = mode.kind === "container-startup"
    ? await containerStartupDiagnostics(sandbox)
    : []
  throw new Error(
    [
      `Timed out waiting for Daytona worker health at ${healthUrl}`,
      `startup mode: ${mode.kind}`,
      `last probe: ${lastProbe}`,
      logs?.stdout?.trim() ? `stdout:\n${logs.stdout.trim().slice(-4000)}` : "",
      logs?.stderr?.trim() ? `stderr:\n${logs.stderr.trim().slice(-4000)}` : "",
      ...diagnostics,
    ]
      .filter(Boolean)
      .join("\n\n"),
  )
}

async function hasDaytonaWorkerStartupScript(sandbox: Sandbox) {
  const result = await sandbox.process.executeCommand(
    `test -x ${shellQuote(daytonaWorkerStartupScriptPath)} && test -f ${shellQuote(daytonaWorkerAutostartMarkerPath)}`,
    undefined,
    undefined,
    10,
  )

  return result.exitCode === 0
}

async function upsertDaytonaSandbox(input: {
  workerId: WorkerId
  sandboxId: string
  workspaceVolumeId: string
  dataVolumeId: string
  signedPreviewUrl: string
  signedPreviewUrlExpiresAt: Date
  region: string | null
}) {
  const existing = await db
    .select({ id: DaytonaSandboxTable.id })
    .from(DaytonaSandboxTable)
    .where(eq(DaytonaSandboxTable.worker_id, input.workerId))
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(DaytonaSandboxTable)
      .set({
        sandbox_id: input.sandboxId,
        workspace_volume_id: input.workspaceVolumeId,
        data_volume_id: input.dataVolumeId,
        signed_preview_url: input.signedPreviewUrl,
        signed_preview_url_expires_at: input.signedPreviewUrlExpiresAt,
        region: input.region,
      })
      .where(eq(DaytonaSandboxTable.worker_id, input.workerId))
    return
  }

  await db.insert(DaytonaSandboxTable).values({
    id: createDenTypeId("daytonaSandbox"),
    worker_id: input.workerId,
    sandbox_id: input.sandboxId,
    workspace_volume_id: input.workspaceVolumeId,
    data_volume_id: input.dataVolumeId,
    signed_preview_url: input.signedPreviewUrl,
    signed_preview_url_expires_at: input.signedPreviewUrlExpiresAt,
    region: input.region,
  })
}

export async function getDaytonaSandboxRecord(workerId: WorkerId) {
  const rows = await db
    .select()
    .from(DaytonaSandboxTable)
    .where(eq(DaytonaSandboxTable.worker_id, workerId))
    .limit(1)

  return rows[0] ?? null
}

export async function refreshDaytonaSignedPreview(workerId: WorkerId) {
  assertDaytonaConfig()

  const record = await getDaytonaSandboxRecord(workerId)
  if (!record) {
    return null
  }

  const daytona = createDaytonaClient()
  const sandbox = await daytona.get(record.sandbox_id)
  await sandbox.refreshData()

  const expiresInSeconds = normalizedSignedPreviewExpirySeconds()
  const preview = await sandbox.getSignedPreviewUrl(env.daytona.openworkPort, expiresInSeconds)
  const expiresAt = signedPreviewRefreshAt(expiresInSeconds)

  await db
    .update(DaytonaSandboxTable)
    .set({
      signed_preview_url: preview.url,
      signed_preview_url_expires_at: expiresAt,
      region: sandbox.target,
    })
    .where(eq(DaytonaSandboxTable.worker_id, workerId))

  return {
    ...record,
    signed_preview_url: preview.url,
    signed_preview_url_expires_at: expiresAt,
    region: sandbox.target,
  }
}

export async function getDaytonaSignedPreviewForProxy(workerId: WorkerId) {
  const record = await getDaytonaSandboxRecord(workerId)
  if (!record) {
    return null
  }

  if (record.signed_preview_url_expires_at.getTime() > Date.now()) {
    return record.signed_preview_url
  }

  const refreshed = await refreshDaytonaSignedPreview(workerId)
  return refreshed?.signed_preview_url ?? null
}

export async function provisionWorkerOnDaytona(
  input: ProvisionInput,
): Promise<ProvisionedInstance> {
  assertDaytonaConfig()

  const daytona = createDaytonaClient()
  const labels = sandboxLabels(input.workerId)
  const sharedVolumeNameValue = sharedVolumeName()
  await daytona.volume.get(sharedVolumeNameValue, true)
  const sharedVolume = await waitForVolumeReady(
    daytona,
    sharedVolumeNameValue,
    env.daytona.createTimeoutSeconds * 1000,
  )
  const runtimeEnv: DaytonaWorkerRuntimeEnv = buildDaytonaWorkerRuntimeEnv({
    workerId: input.workerId,
    hostToken: input.hostToken,
    clientToken: input.clientToken,
    activityToken: input.activityToken,
    activityHeartbeatUrl: workerActivityHeartbeatUrl(input.workerId),
    workspaceMountPath: env.daytona.workspaceMountPath,
    dataMountPath: env.daytona.dataMountPath,
    runtimeWorkspacePath: env.daytona.runtimeWorkspacePath,
    runtimeDataPath: env.daytona.runtimeDataPath,
    sidecarDir: env.daytona.sidecarDir,
    openworkPort: env.daytona.openworkPort,
    opencodePort: env.daytona.opencodePort,
  })
  let sandbox: Awaited<ReturnType<typeof daytona.create>> | null = null

  try {
    sandbox = env.daytona.snapshot
      ? await daytona.create(
          {
            name: sandboxName(input),
            snapshot: env.daytona.snapshot,
            autoStopInterval: env.daytona.autoStopInterval,
            autoArchiveInterval: env.daytona.autoArchiveInterval,
            autoDeleteInterval: env.daytona.autoDeleteInterval,
            public: env.daytona.public,
            labels,
            envVars: runtimeEnv,
            volumes: sharedVolumeMounts(input.workerId, sharedVolume.id),
          },
          { timeout: env.daytona.createTimeoutSeconds },
        )
      : await daytona.create(
          {
            name: sandboxName(input),
            image: env.daytona.image,
            autoStopInterval: env.daytona.autoStopInterval,
            autoArchiveInterval: env.daytona.autoArchiveInterval,
            autoDeleteInterval: env.daytona.autoDeleteInterval,
            public: env.daytona.public,
            labels,
            envVars: runtimeEnv,
            resources: {
              cpu: env.daytona.resources.cpu,
              memory: env.daytona.resources.memory,
              disk: env.daytona.resources.disk,
            },
            volumes: sharedVolumeMounts(input.workerId, sharedVolume.id),
          },
          { timeout: env.daytona.createTimeoutSeconds },
        )

    let healthMode: HealthWaitMode
    if (await hasDaytonaWorkerStartupScript(sandbox)) {
      healthMode = { kind: "container-startup" }
    } else {
      logger.info("Daytona image lacks entrypoint autostart marker; using legacy session fallback", {
        worker_id: input.workerId,
        sandbox_id: sandbox.id,
      })
      const sessionId = `openwork-${workerHint(input.workerId)}`
      await sandbox.process.createSession(sessionId)
      const command = await sandbox.process.executeSessionCommand(
        sessionId,
        {
          command: buildOpenWorkStartCommand(),
          runAsync: true,
        },
        0,
      )
      healthMode = { kind: "legacy-session", sessionId, commandId: command.cmdId }
    }

    const expiresInSeconds = normalizedSignedPreviewExpirySeconds()
    const preview = await sandbox.getSignedPreviewUrl(env.daytona.openworkPort, expiresInSeconds)
    await waitForHealth(preview.url, env.daytona.healthcheckTimeoutMs, sandbox, healthMode)
    await upsertDaytonaSandbox({
      workerId: input.workerId,
      sandboxId: sandbox.id,
      workspaceVolumeId: sharedVolume.id,
      dataVolumeId: sharedVolume.id,
      signedPreviewUrl: preview.url,
      signedPreviewUrlExpiresAt: signedPreviewRefreshAt(expiresInSeconds),
      region: sandbox.target ?? null,
    })

    return {
      provider: "daytona",
      url: workerProxyUrl(input.workerId),
      status: "healthy",
      region: sandbox.target,
    }
  } catch (error) {
    if (sandbox) {
      await sandbox.delete(env.daytona.deleteTimeoutSeconds).catch(() => {})
    }
    throw error
  }
}

export async function deprovisionWorkerOnDaytona(workerId: WorkerId) {
  assertDaytonaConfig()

  const daytona = createDaytonaClient()
  const record = await getDaytonaSandboxRecord(workerId)

  if (record) {
    try {
      const sandbox = await daytona.get(record.sandbox_id)
      await sandbox.delete(env.daytona.deleteTimeoutSeconds)
    } catch (error) {
      logger.warn("failed to delete Daytona sandbox", { worker_id: workerId, sandbox_id: record.sandbox_id, error })
    }

    await cleanupWorkerDataOnDaytona(daytona, workerId)

    return
  }

  const sandboxIds = await listDaytonaSandboxIdsByLabels(sandboxLabels(workerId))

  for (const sandboxId of sandboxIds) {
    await daytona
      .get(sandboxId)
      .then((sandbox) => sandbox.delete(env.daytona.deleteTimeoutSeconds))
      .catch((error) => {
        logger.warn("failed to delete Daytona sandbox", { worker_id: workerId, sandbox_id: sandboxId, error })
      })
  }

  await cleanupWorkerDataOnDaytona(daytona, workerId)
}
