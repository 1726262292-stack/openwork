export const daytonaWorkerStartupScriptPath = "/usr/local/bin/openwork-daytona-worker-start"
export const daytonaWorkerStartupLogPath = "/tmp/openwork-daytona-worker-start.log"
export const daytonaWorkerAutostartMarkerPath = "/usr/local/share/openwork/daytona-worker-entrypoint"

export type DaytonaWorkerRuntimeEnv = Record<string, string>

export type DaytonaWorkerRuntimeEnvInput = {
  workerId: string
  hostToken: string
  clientToken: string
  activityToken: string
  activityHeartbeatUrl: string
  workspaceMountPath: string
  dataMountPath: string
  runtimeWorkspacePath: string
  runtimeDataPath: string
  sidecarDir: string
  openworkPort: number
  opencodePort: number
}

export const daytonaWorkerRuntimeEnvKeys = [
  "DEN_RUNTIME_PROVIDER",
  "DEN_WORKER_ID",
  "DEN_ACTIVITY_HEARTBEAT_ENABLED",
  "DEN_ACTIVITY_HEARTBEAT_URL",
  "DEN_ACTIVITY_HEARTBEAT_TOKEN",
  "OPENWORK_TOKEN",
  "OPENWORK_HOST_TOKEN",
  "OPENWORK_DATA_DIR",
  "OPENWORK_SIDECAR_DIR",
  "OPENWORK_WORKSPACE",
  "OPENWORK_PORT",
  "OPENWORK_OPENCODE_HOST",
  "OPENWORK_OPENCODE_PORT",
  "OPENWORK_CONNECT_HOST",
  "OPENWORK_CORS",
  "OPENWORK_APPROVAL",
  "OPENWORK_OPENCODE_SOURCE",
  "DAYTONA_WORKSPACE_MOUNT_PATH",
  "DAYTONA_DATA_MOUNT_PATH",
]

export function buildDaytonaWorkerRuntimeEnv(
  input: DaytonaWorkerRuntimeEnvInput,
): DaytonaWorkerRuntimeEnv {
  return {
    DEN_RUNTIME_PROVIDER: "daytona",
    DEN_WORKER_ID: input.workerId,
    DEN_ACTIVITY_HEARTBEAT_ENABLED: "1",
    DEN_ACTIVITY_HEARTBEAT_URL: input.activityHeartbeatUrl,
    DEN_ACTIVITY_HEARTBEAT_TOKEN: input.activityToken,
    OPENWORK_TOKEN: input.clientToken,
    OPENWORK_HOST_TOKEN: input.hostToken,
    OPENWORK_DATA_DIR: input.runtimeDataPath,
    OPENWORK_SIDECAR_DIR: input.sidecarDir,
    OPENWORK_WORKSPACE: input.runtimeWorkspacePath,
    OPENWORK_PORT: String(input.openworkPort),
    OPENWORK_OPENCODE_HOST: "127.0.0.1",
    OPENWORK_OPENCODE_PORT: String(input.opencodePort),
    OPENWORK_CONNECT_HOST: "127.0.0.1",
    OPENWORK_CORS: "*",
    OPENWORK_APPROVAL: "manual",
    OPENWORK_OPENCODE_SOURCE: "external",
    DAYTONA_WORKSPACE_MOUNT_PATH: input.workspaceMountPath,
    DAYTONA_DATA_MOUNT_PATH: input.dataMountPath,
  }
}
