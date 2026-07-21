import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPendingNukeCleanup } from "./nuke.mjs";

const WORKER_RETRY_INTERVAL_MS = 500;
const DEBUG_PORT_WAIT_DEADLINE_MS = 30_000;
const DEBUG_PORT_WAIT_INITIAL_INTERVAL_MS = 100;
const DEBUG_PORT_WAIT_MAX_INTERVAL_MS = 500;
const NO_DEBUG_PORT_GRACE_MS = 500;
const REMOTE_DEBUGGING_PORT_ARG = "--remote-debugging-port=";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function isAbsoluteForPlatform(value, platform) {
  return pathApi(platform).isAbsolute(String(value ?? ""));
}

function parentIsAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function safePort(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number.parseInt(text, 10);
  return port > 0 && port <= 65535 ? port : null;
}

export function remoteDebugPortFromPayload(payload) {
  const appArgv = Array.isArray(payload?.appArgv) ? payload.appArgv : [];
  for (const arg of appArgv) {
    const text = typeof arg === "string" ? arg.trim() : "";
    if (!text.startsWith(REMOTE_DEBUGGING_PORT_ARG)) continue;
    const port = safePort(text.slice(REMOTE_DEBUGGING_PORT_ARG.length));
    if (port) return port;
  }
  return safePort(payload?.nukeInput?.env?.OPENWORK_ELECTRON_REMOTE_DEBUG_PORT);
}

export function validateNukeWorkerPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid nuke worker payload.");
  }
  const payload = value;
  const nukeInput = payload.nukeInput;
  if (!nukeInput || typeof nukeInput !== "object" || Array.isArray(nukeInput)) {
    throw new Error("Invalid nuke worker nukeInput.");
  }
  const platform = nukeInput.platform === "win32" || nukeInput.platform === "darwin" || nukeInput.platform === "linux"
    ? nukeInput.platform
    : "linux";
  const homedir = typeof nukeInput.homedir === "string" ? nukeInput.homedir : "";
  const userDataPath = typeof nukeInput.userDataPath === "string" ? nukeInput.userDataPath : "";
  const appExecutablePath = typeof payload.appExecutablePath === "string" ? payload.appExecutablePath : "";
  if (!isAbsoluteForPlatform(homedir, platform) || !isAbsoluteForPlatform(userDataPath, platform)) {
    throw new Error("Nuke worker paths must be absolute.");
  }
  if (!path.isAbsolute(appExecutablePath)) {
    throw new Error("Nuke worker app executable path must be absolute.");
  }
  const appArgv = Array.isArray(payload.appArgv) ? payload.appArgv.filter((arg) => typeof arg === "string") : [];
  const parentPid = Number(payload.parentPid) || 0;
  const now = Date.now();
  const parentWaitDeadlineAt = Number.isFinite(payload.parentWaitDeadlineAt) ? Number(payload.parentWaitDeadlineAt) : now;
  const deadlineAt = Number.isFinite(payload.deadlineAt) ? Number(payload.deadlineAt) : now;
  return {
    version: 1,
    parentPid,
    nukeInput: {
      env: nukeInput.env && typeof nukeInput.env === "object" && !Array.isArray(nukeInput.env) ? nukeInput.env : {},
      homedir,
      platform,
      userDataPath,
    },
    appExecutablePath,
    appArgv,
    pendingPath: typeof payload.pendingPath === "string" ? payload.pendingPath : "",
    parentWaitDeadlineAt,
    deadlineAt,
  };
}

async function waitForParentExit(parentPid, deadlineAt, deps) {
  const sleepFn = deps.sleep ?? sleep;
  while (Date.now() < deadlineAt && parentIsAlive(parentPid)) {
    await sleepFn(WORKER_RETRY_INTERVAL_MS);
  }
}

async function cleanupUntilDeadline(payload, deps) {
  const sleepFn = deps.sleep ?? sleep;
  const runPendingCleanup = deps.runPendingCleanup ?? runPendingNukeCleanup;
  let result = await runPendingCleanup(payload.nukeInput);
  while (result.pendingRetry.length > 0 && Date.now() < payload.deadlineAt) {
    await sleepFn(WORKER_RETRY_INTERVAL_MS);
    result = await runPendingCleanup(payload.nukeInput);
  }
  return result;
}

function probeDebugPortBindable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let done = false;
    const finish = (available) => {
      if (done) return;
      done = true;
      server.removeAllListeners();
      if (server.listening) {
        server.close(() => resolve(available));
        return;
      }
      resolve(available);
    };
    server.once("error", () => finish(false));
    server.listen({ port, host: "127.0.0.1" }, () => finish(true));
  });
}

function boundedMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

async function waitForDebugPortRelease(payload, deps) {
  const port = remoteDebugPortFromPayload(payload);
  const sleepFn = deps.sleep ?? sleep;
  if (!port) {
    const graceMs = boundedMs(deps.noDebugPortGraceMs, NO_DEBUG_PORT_GRACE_MS);
    if (graceMs > 0) await sleepFn(graceMs);
    return { port: null, available: true, timedOut: false };
  }

  const probe = deps.probeDebugPortBindable ?? probeDebugPortBindable;
  const waitMs = boundedMs(deps.debugPortWaitDeadlineMs, DEBUG_PORT_WAIT_DEADLINE_MS);
  const maxIntervalMs = boundedMs(deps.debugPortWaitMaxIntervalMs, DEBUG_PORT_WAIT_MAX_INTERVAL_MS);
  let intervalMs = boundedMs(deps.debugPortWaitInitialIntervalMs, DEBUG_PORT_WAIT_INITIAL_INTERVAL_MS);
  const deadlineAt = Date.now() + waitMs;
  while (true) {
    if (await probe(port)) return { port, available: true, timedOut: false };
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return { port, available: false, timedOut: true };
    await sleepFn(Math.min(intervalMs, remainingMs));
    intervalMs = Math.min(Math.max(intervalMs * 2, 1), maxIntervalMs);
  }
}

function launchApp(payload, deps) {
  const spawnApp = deps.spawnApp ?? spawn;
  const env = { ...(deps.env ?? process.env) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnApp(payload.appExecutablePath, payload.appArgv, {
    detached: true,
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref?.();
  return child.pid ?? null;
}

export async function runNukeCleanupWorker(payloadPath, deps = {}) {
  const raw = JSON.parse(await readFile(payloadPath, "utf8"));
  const payload = validateNukeWorkerPayload(raw);
  await waitForParentExit(payload.parentPid, payload.parentWaitDeadlineAt, deps);
  let cleanup = null;
  try {
    cleanup = await cleanupUntilDeadline(payload, deps);
  } catch (error) {
    cleanup = {
      ran: false,
      invalid: false,
      deleted: [],
      pendingRetry: [],
      errors: [{ path: "nuke-cleanup-worker", message: errorMessage(error) }],
    };
  }
  const portWait = await waitForDebugPortRelease(payload, deps);
  await rm(payloadPath, { force: true }).catch(() => undefined);
  const launchPid = launchApp(payload, deps);
  return { cleanup, launchPid, portWait };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runNukeCleanupWorker(String(process.argv[2] ?? "")).catch(() => {
    process.exitCode = 1;
  });
}
