import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildDaytonaWorkerRuntimeEnv,
  daytonaWorkerAutostartMarkerPath,
  daytonaWorkerRuntimeEnvKeys,
  daytonaWorkerStartupScriptPath,
} from "../src/workers/daytona-runtime-env.js"

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const startupScript = join(rootDir, "ee", "apps", "den-worker-runtime", "openwork-daytona-worker-start")
const snapshotDockerfile = join(rootDir, "ee", "apps", "den-worker-runtime", "Dockerfile.daytona-snapshot")

async function writeExecutable(path: string, contents: string) {
  await writeFile(path, contents)
  await chmod(path, 0o755)
}

function runStartupScript(env: Record<string, string>, args: string[] = []) {
  return spawnSync("sh", [startupScript, ...args], {
    encoding: "utf8",
    env,
    timeout: 20_000,
  })
}

describe("Daytona snapshot Dockerfile contract", () => {
  test("uses the startup script as ENTRYPOINT and marks corrected autostart images", async () => {
    const dockerfile = await readFile(snapshotDockerfile, "utf8")

    expect(dockerfile).toContain(`ENTRYPOINT ["${daytonaWorkerStartupScriptPath}"]`)
    expect(dockerfile).not.toContain(`CMD ["${daytonaWorkerStartupScriptPath}"]`)
    expect(dockerfile).toContain(daytonaWorkerAutostartMarkerPath)
  })
})

describe("Daytona worker runtime env contract", () => {
  test("contains every value needed to recreate openwork serve after a restart", () => {
    const runtimeEnv = buildDaytonaWorkerRuntimeEnv({
      workerId: "worker_123",
      hostToken: "host-secret",
      clientToken: "client-secret",
      activityToken: "activity-secret",
      activityHeartbeatUrl: "https://den.example/v1/workers/worker_123/activity-heartbeat",
      workspaceMountPath: "/workspace",
      dataMountPath: "/persist/openwork",
      runtimeWorkspacePath: "/tmp/openwork-workspace",
      runtimeDataPath: "/tmp/openwork-data",
      sidecarDir: "/tmp/openwork-sidecars",
      openworkPort: 8787,
      opencodePort: 4096,
    })

    for (const key of daytonaWorkerRuntimeEnvKeys) {
      expect(runtimeEnv[key]).toBeTruthy()
    }
    expect(runtimeEnv).toMatchObject({
      DEN_RUNTIME_PROVIDER: "daytona",
      DEN_WORKER_ID: "worker_123",
      DEN_ACTIVITY_HEARTBEAT_ENABLED: "1",
      DEN_ACTIVITY_HEARTBEAT_TOKEN: "activity-secret",
      OPENWORK_TOKEN: "client-secret",
      OPENWORK_HOST_TOKEN: "host-secret",
      OPENWORK_WORKSPACE: "/tmp/openwork-workspace",
      OPENWORK_DATA_DIR: "/tmp/openwork-data",
      OPENWORK_PORT: "8787",
      OPENWORK_OPENCODE_HOST: "127.0.0.1",
      OPENWORK_OPENCODE_PORT: "4096",
      OPENWORK_CONNECT_HOST: "127.0.0.1",
      OPENWORK_CORS: "*",
      OPENWORK_APPROVAL: "manual",
      OPENWORK_OPENCODE_SOURCE: "external",
      DAYTONA_WORKSPACE_MOUNT_PATH: "/workspace",
      DAYTONA_DATA_MOUNT_PATH: "/persist/openwork",
    })
  })
})

describe("openwork-daytona-worker-start", () => {
  test("keeps snapshot validation containers alive when no worker id is configured", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "daytona-startup-no-worker-"))
    try {
      const binDir = join(tempDir, "bin")
      const capture = join(tempDir, "sleep.txt")
      await mkdir(binDir)
      await writeExecutable(join(binDir, "sleep"), `#!/usr/bin/env sh
printf '%s\n' "$*" > "$OPENWORK_TEST_CAPTURE"
exit 0
`)

      const result = runStartupScript({
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        OPENWORK_TEST_CAPTURE: capture,
      }, ["node"])

      expect(result.status).toBe(0)
      expect(result.stderr).toContain("DEN_WORKER_ID not set")
      expect((await readFile(capture, "utf8")).trim()).toBe("infinity")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("fails clearly when a configured worker is missing required runtime config", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "daytona-startup-missing-config-"))
    try {
      const binDir = join(tempDir, "bin")
      await mkdir(binDir)
      const result = runStartupScript({
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        DEN_WORKER_ID: "worker_123",
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain("DEN_RUNTIME_PROVIDER is required when DEN_WORKER_ID is set")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("logs the real failing openwork status before retrying", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "daytona-startup-retry-"))
    try {
      const binDir = join(tempDir, "bin")
      const countFile = join(tempDir, "openwork-count.txt")
      const sleepCapture = join(tempDir, "sleep.txt")
      const startupLog = join(tempDir, "startup.log")
      await mkdir(binDir)
      await writeExecutable(join(binDir, "opencode"), `#!/usr/bin/env sh
printf 'fake opencode\n'
`)
      await writeExecutable(join(binDir, "sleep"), `#!/usr/bin/env sh
printf '%s\n' "$*" >> "$OPENWORK_TEST_SLEEP_CAPTURE"
exit 0
`)
      await writeExecutable(join(binDir, "openwork"), `#!/usr/bin/env sh
count=0
if [ -f "$OPENWORK_TEST_COUNT" ]; then
  IFS= read -r count < "$OPENWORK_TEST_COUNT"
fi
count=$((count + 1))
printf '%s\n' "$count" > "$OPENWORK_TEST_COUNT"
printf 'openwork attempt %s\n' "$count"
if [ "$count" -eq 1 ]; then
  exit 7
fi
exit 0
`)

      const result = runStartupScript({
        ...buildDaytonaWorkerRuntimeEnv({
          workerId: "worker_123",
          hostToken: "host-secret",
          clientToken: "client-secret",
          activityToken: "activity-secret",
          activityHeartbeatUrl: "https://den.example/v1/workers/worker_123/activity-heartbeat",
          workspaceMountPath: join(tempDir, "mounted-workspace"),
          dataMountPath: join(tempDir, "mounted-data"),
          runtimeWorkspacePath: join(tempDir, "runtime-workspace"),
          runtimeDataPath: join(tempDir, "runtime-data"),
          sidecarDir: join(tempDir, "sidecars"),
          openworkPort: 8787,
          opencodePort: 4096,
        }),
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        OPENWORK_STARTUP_LOG: startupLog,
        OPENWORK_TEST_COUNT: countFile,
        OPENWORK_TEST_SLEEP_CAPTURE: sleepCapture,
      })

      expect(result.status).toBe(0)
      expect(result.stderr).toContain("OpenWork output will append to")
      expect(result.stderr).toContain("openwork serve failed (attempt 1, exit 7)")
      expect((await readFile(countFile, "utf8")).trim()).toBe("2")
      expect((await readFile(sleepCapture, "utf8")).trim()).toBe("3")
      expect(await readFile(startupLog, "utf8")).toContain("openwork attempt 2")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("starts openwork with the restart-safe env contract and volume symlinks", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "daytona-startup-worker-"))
    try {
      const binDir = join(tempDir, "bin")
      const capture = join(tempDir, "openwork.txt")
      const workspaceMount = join(tempDir, "mounted-workspace")
      const dataMount = join(tempDir, "mounted-data")
      const runtimeWorkspace = join(tempDir, "runtime-workspace")
      const runtimeData = join(tempDir, "runtime-data")
      const sidecarDir = join(tempDir, "sidecars")
      const injectionMarker = join(tempDir, "should-not-exist")
      const clientToken = `client-$(touch ${injectionMarker})-literal`
      await mkdir(binDir)
      await writeExecutable(join(binDir, "opencode"), `#!/usr/bin/env sh
printf 'fake opencode\n'
`)
      await writeExecutable(join(binDir, "openwork"), `#!/usr/bin/env sh
: > "$OPENWORK_TEST_CAPTURE"
i=0
for arg in "$@"; do
  printf 'ARG_%s=%s\n' "$i" "$arg" >> "$OPENWORK_TEST_CAPTURE"
  i=$((i + 1))
done
for name in DEN_RUNTIME_PROVIDER DEN_WORKER_ID DEN_ACTIVITY_HEARTBEAT_ENABLED DEN_ACTIVITY_HEARTBEAT_URL DEN_ACTIVITY_HEARTBEAT_TOKEN OPENWORK_TOKEN OPENWORK_HOST_TOKEN OPENWORK_DATA_DIR OPENWORK_SIDECAR_DIR OPENWORK_WORKSPACE OPENWORK_PORT OPENWORK_OPENCODE_HOST OPENWORK_OPENCODE_PORT OPENWORK_CONNECT_HOST OPENWORK_CORS OPENWORK_APPROVAL OPENWORK_OPENCODE_SOURCE DAYTONA_WORKSPACE_MOUNT_PATH DAYTONA_DATA_MOUNT_PATH; do
  value="$(printenv "$name")"
  printf 'ENV_%s=%s\n' "$name" "$value" >> "$OPENWORK_TEST_CAPTURE"
done
exit 0
`)

      const result = runStartupScript({
        ...buildDaytonaWorkerRuntimeEnv({
          workerId: "worker_123",
          hostToken: "host-secret",
          clientToken,
          activityToken: "activity-secret",
          activityHeartbeatUrl: "https://den.example/v1/workers/worker_123/activity-heartbeat",
          workspaceMountPath: workspaceMount,
          dataMountPath: dataMount,
          runtimeWorkspacePath: runtimeWorkspace,
          runtimeDataPath: runtimeData,
          sidecarDir,
          openworkPort: 8787,
          opencodePort: 4096,
        }),
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        OPENWORK_STARTUP_LOG: join(tempDir, "startup.log"),
        OPENWORK_TEST_CAPTURE: capture,
      })

      expect(result.status).toBe(0)
      const captured = await readFile(capture, "utf8")
      const opencodePath = join(binDir, "opencode")
      expect(captured).toContain("ARG_0=serve")
      expect(captured).toContain(`ARG_2=${runtimeWorkspace}`)
      expect(captured).toContain("ARG_3=--remote-access")
      expect(captured).toContain("ARG_4=--openwork-port")
      expect(captured).toContain("ARG_5=8787")
      expect(captured).toContain("ARG_6=--opencode-host")
      expect(captured).toContain("ARG_7=127.0.0.1")
      expect(captured).toContain("ARG_8=--opencode-port")
      expect(captured).toContain("ARG_9=4096")
      expect(captured).toContain("ARG_10=--connect-host")
      expect(captured).toContain("ARG_11=127.0.0.1")
      expect(captured).toContain("ARG_12=--cors")
      expect(captured).toContain("ARG_13=*")
      expect(captured).toContain("ARG_14=--approval")
      expect(captured).toContain("ARG_15=manual")
      expect(captured).toContain("ARG_16=--allow-external")
      expect(captured).toContain("ARG_17=--opencode-source")
      expect(captured).toContain("ARG_18=external")
      expect(captured).toContain("ARG_19=--opencode-bin")
      expect(captured).toContain(`ARG_20=${opencodePath}`)
      expect(captured).toContain("ARG_21=--verbose")
      expect(captured).toContain("ENV_DEN_ACTIVITY_HEARTBEAT_TOKEN=activity-secret")
      expect(captured).toContain(`ENV_OPENWORK_TOKEN=${clientToken}`)
      expect(captured).toContain("ENV_OPENWORK_HOST_TOKEN=host-secret")
      expect(captured).toContain(`ENV_OPENWORK_DATA_DIR=${runtimeData}`)
      expect(captured).toContain(`ENV_OPENWORK_SIDECAR_DIR=${sidecarDir}`)
      expect(await lstat(injectionMarker).then(() => true, () => false)).toBe(false)

      expect((await lstat(join(runtimeWorkspace, "volumes", "workspace"))).isSymbolicLink()).toBe(true)
      expect(await readlink(join(runtimeWorkspace, "volumes", "workspace"))).toBe(workspaceMount)
      expect((await lstat(join(runtimeWorkspace, "volumes", "data"))).isSymbolicLink()).toBe(true)
      expect(await readlink(join(runtimeWorkspace, "volumes", "data"))).toBe(dataMount)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
