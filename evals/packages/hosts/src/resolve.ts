import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDaytonaHost } from "./daytona.ts";
import { createLocalHost } from "./local.ts";
import type { Host } from "./types.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

/** True when this process is itself running inside a Daytona sandbox. */
export function runningInsideSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.DAYTONA_SANDBOX_ID ?? "").trim().length > 0) return true;
  return existsSync("/daytona-secrets") || existsSync("/daytona-artifacts");
}

export async function resolveHost(env: NodeJS.ProcessEnv = process.env): Promise<Host & AsyncDisposable> {
  const sandboxId = env.OPENWORK_EVAL_DAYTONA_SANDBOX?.trim();
  // The Daytona host drives the `daytona` CLI from OUTSIDE a sandbox. When the
  // caller is already inside one, that indirection cannot work — spawn locally,
  // which is the same machine the sandbox host would have targeted anyway.
  if (sandboxId && !runningInsideSandbox(env)) {
    return createDaytonaHost({ sandboxId, repoRoot: REPO_ROOT, log: () => undefined });
  }
  return createLocalHost({ repoRoot: REPO_ROOT, log: () => undefined });
}
