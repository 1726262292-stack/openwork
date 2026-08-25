import { readFile, readdir, unlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlace } from "./place.ts";
import { acmeDemo, acmeDocs, desktopProductionLive, soloWorkspace, supportOrg } from "./presets.ts";
import type { Place } from "./place.ts";
import { usesLiveSharedProductionState } from "./topology.ts";
import type { WorldDefinition, WorldTopology } from "./topology.ts";
import { fromSnapshot, parseUntrustedSnapshot, resumeWorld as attachWorld, startWorld } from "./world.ts";
import type { ResumedWorld, StartWorldOptions, WorldTeardownResult } from "./world.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const WORLDS_DIR = join(REPO_ROOT, "evals", "results", ".worlds");

export const presetCatalog: Record<string, WorldDefinition> = {
  "acme-demo": acmeDemo,
  "acme-docs": acmeDocs,
  "desktop-prod-live": desktopProductionLive,
  solo: soloWorkspace,
  "support-org": supportOrg,
};

export type WorldCommand =
  | { kind: "up"; preset: string; name?: string; keep?: boolean; allowSharedState?: boolean }
  | { kind: "rebuild"; snapshotPath: string; allowSharedState?: boolean }
  | { kind: "resume"; nameOrSnapshotPath: string; teardown?: boolean }
  | { kind: "list" }
  | { kind: "forget"; name: string }
  | { kind: "help"; error?: string };

interface StartedWorld extends AsyncDisposable {
  name: string;
  topology: WorldTopology;
  den: { ref: { apiUrl: string; webUrl: string } };
  apps: Record<string, { handle: { cdpUrl: string }; client?: { close(): void } }>;
  snapshotPath: string;
}

interface DisplayWorld {
  name: string;
  topology: WorldTopology;
  den: { ref: { apiUrl: string; webUrl: string } };
  apps: Record<string, { handle: { cdpUrl: string } }>;
}

interface WorldIo {
  print?: (line: string) => void;
  startWorld?: (
    definition: WorldDefinition | WorldTopology,
    options?: StartWorldOptions,
  ) => Promise<StartedWorld>;
  resumeWorld?: (
    snapshotJsonText: string,
    options?: { teardown?: boolean },
  ) => Promise<ResumedWorld>;
  readFile?: (path: string) => Promise<string>;
  readDir?: (path: string) => Promise<string[]>;
  deleteFile?: (path: string) => Promise<void>;
  onExit?: () => Promise<void>;
}

function helpError(message: string): WorldCommand {
  return { kind: "help", error: message };
}

export function parseWorldArgs(argv: string[]): WorldCommand {
  const [command, ...args] = argv;
  if (!command || command === "help") {
    return args.length === 0 ? { kind: "help" } : helpError("The help command does not take arguments.");
  }
  if (command === "up") {
    const [preset, ...options] = args;
    if (!preset) return helpError("The up command needs a preset.");
    if (!Object.hasOwn(presetCatalog, preset)) return helpError(`Unknown preset ${JSON.stringify(preset)}.`);
    let name: string | undefined;
    let keep = false;
    let allowSharedState = false;
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      if (option === "--keep" && !keep) {
        keep = true;
        continue;
      }
      if (option === "--allow-shared-state" && !allowSharedState) {
        allowSharedState = true;
        continue;
      }
      if (option === "--name" && name === undefined) {
        const value = options[index + 1];
        if (!value || value.startsWith("--")) return helpError("Use --name followed by one name after the preset.");
        name = value;
        index += 1;
        continue;
      }
      return helpError("Use --name <name>, --keep, and/or --allow-shared-state after the preset.");
    }
    return {
      kind: "up",
      preset,
      ...(name === undefined ? {} : { name }),
      ...(keep ? { keep: true } : {}),
      ...(allowSharedState ? { allowSharedState: true } : {}),
    };
  }
  if (command === "rebuild") {
    const [snapshotPath, ...options] = args;
    if (!snapshotPath) return helpError("The rebuild command needs one snapshot path.");
    if (options.length === 0) return { kind: "rebuild", snapshotPath };
    if (options.length === 1 && options[0] === "--allow-shared-state") {
      return { kind: "rebuild", snapshotPath, allowSharedState: true };
    }
    return helpError("Use only --allow-shared-state after the rebuild snapshot path.");
  }
  if (command === "resume") {
    const [nameOrSnapshotPath, ...options] = args;
    if (!nameOrSnapshotPath) return helpError("The resume command needs a world name or snapshot path.");
    if (options.length === 0) return { kind: "resume", nameOrSnapshotPath };
    if (options.length === 1 && options[0] === "--teardown") {
      return { kind: "resume", nameOrSnapshotPath, teardown: true };
    }
    return helpError("Use only --teardown after the world name or snapshot path.");
  }
  if (command === "list") {
    return args.length === 0 ? { kind: "list" } : helpError("The list command does not take arguments.");
  }
  if (command === "forget") {
    return args.length === 1 && args[0]
      ? { kind: "forget", name: args[0] }
      : helpError("The forget command needs exactly one world name.");
  }
  if (command === "down") return helpError('Unknown command "down"; use `world resume <name> --teardown` to stop a detached world.');
  return helpError(`Unknown command ${JSON.stringify(command)}.`);
}

const HELP = `Usage:
  pnpm world up <preset> [--name <name>] [--keep] [--allow-shared-state]
      Start a world from a preset. --keep leaves its detached services running after Ctrl-C.
      --allow-shared-state explicitly permits a local live-shared production-state desktop.
  pnpm world rebuild <snapshot-path> [--allow-shared-state]
      Start a new world using a saved snapshot. Shared state requires the opt-in again.
  pnpm world resume <name-or-snapshot-path> [--teardown]
      Attach to a detached world, or stop its services and database with --teardown.
  pnpm world list
      Show every saved world snapshot.
  pnpm world forget <name>
      Remove a saved world snapshot without stopping services.
  pnpm world help
      Show this help.

Presets: acme-demo, acme-docs, desktop-prod-live, solo, support-org

Live shared production state:
  pnpm world up desktop-prod-live --allow-shared-state --name prod-live-dev --keep`;

function messageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultOnExit(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

function displayPath(path: string): string {
  const repoPath = relative(REPO_ROOT, path);
  return repoPath.startsWith("..") ? path : repoPath;
}

function printStarted(
  world: DisplayWorld,
  description: string,
  placeKind: string,
  snapshotPath: string,
  lifecycle: string,
  print: (line: string) => void,
): void {
  const sharedProductionState = usesLiveSharedProductionState(world.topology);
  if (sharedProductionState) {
    print("LIVE SHARED PRODUCTION STATE — concurrent writes by production and dev are unsupported and may corrupt state.");
  }
  print(`World ${JSON.stringify(world.name)} is up (${description}, ${placeKind}${sharedProductionState ? ", LIVE SHARED PRODUCTION STATE" : ""}).`);
  if (!sharedProductionState) {
    print(`den web  ${world.den.ref.webUrl}`);
    print(`den api  ${world.den.ref.apiUrl}`);
  }
  for (const [name, app] of Object.entries(world.apps)) {
    const signedInTo = world.topology.apps?.[name]?.signedInTo;
    const signIn = signedInTo ? ` (signed in to ${signedInTo.org} as ${signedInTo.as})` : "";
    print(`app ${name}  CDP ${app.handle.cdpUrl}${signIn}`);
  }
  print(`snapshot  ${displayPath(snapshotPath)}`);
  print(lifecycle);
}

async function runWorld(
  definition: WorldDefinition | WorldTopology,
  options: { place: Place; name?: string; keep?: boolean; allowSharedState?: boolean },
  description: string,
  io: Required<Pick<WorldIo, "print" | "startWorld" | "onExit">>,
): Promise<number> {
  let world: StartedWorld;
  try {
    world = await io.startWorld(definition, options);
  } catch (error) {
    io.print(messageText(error));
    return 1;
  }
  const lifecycle = options.keep
    ? `Detached mode: Ctrl-C leaves everything running. Resume with: pnpm world resume ${world.name} · tear down later with: pnpm world resume ${world.name} --teardown`
    : "Stays up until Ctrl-C; Ctrl-C tears everything down.";
  printStarted(world, description, options.place.kind, world.snapshotPath, lifecycle, io.print);
  try {
    await io.onExit();
    if (options.keep) {
      for (const app of Object.values(world.apps)) app.client?.close();
      return 0;
    }
    await world[Symbol.asyncDispose]();
  } catch (error) {
    io.print(messageText(error));
    return 1;
  }
  io.print(`World ${JSON.stringify(world.name)} torn down.`);
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotSummary(text: string): {
  name: string;
  createdAt: string;
  place: string;
  orgs: string[];
  apps: string[];
  sharedProductionState: boolean;
} {
  const parsed = parseUntrustedSnapshot(text);
  return {
    name: parsed.name,
    createdAt: parsed.createdAt,
    place: parsed.place,
    orgs: Object.keys(parsed.topology.den.orgs),
    apps: Object.keys(parsed.topology.apps ?? {}),
    sharedProductionState: usesLiveSharedProductionState(parsed.topology),
  };
}

function joinedKeys(keys: string[]): string {
  return keys.length > 0 ? keys.join(",") : "(none)";
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function resumeSnapshotPath(nameOrSnapshotPath: string): string {
  return nameOrSnapshotPath.endsWith(".json") || nameOrSnapshotPath.includes("/") || nameOrSnapshotPath.includes("\\")
    ? nameOrSnapshotPath
    : join(WORLDS_DIR, `${nameOrSnapshotPath}.json`);
}

function teardownSummary(name: string, result: WorldTeardownResult): string {
  const apps = result.apps.length > 0 ? result.apps.join(", ") : "none";
  const denPorts = result.denPorts.length > 0 ? result.denPorts.join(", ") : "none";
  const database = result.database ?? "none";
  return `Stopped world ${JSON.stringify(name)}: apps ${apps}; Den ports ${denPorts}; database ${database}.`;
}

export async function main(argv = process.argv.slice(2), io: WorldIo = {}): Promise<number> {
  const print = io.print ?? console.log;
  const boot = io.startWorld ?? startWorld;
  const resume = io.resumeWorld ?? attachWorld;
  const load = io.readFile ?? ((path: string) => readFile(path, "utf8"));
  const listDir = io.readDir ?? readdir;
  const remove = io.deleteFile ?? unlink;
  const onExit = io.onExit ?? defaultOnExit;
  const command = parseWorldArgs(argv);

  if (command.kind === "help") {
    if (command.error) print(command.error);
    print(HELP);
    return command.error ? 1 : 0;
  }
  if (command.kind === "up") {
    const definition = presetCatalog[command.preset];
    if (!definition) throw new Error(`Unknown preset ${JSON.stringify(command.preset)}.`);
    const place = resolvePlace(process.env);
    return runWorld(definition, {
      place,
      name: command.name,
      keep: command.keep,
      allowSharedState: command.allowSharedState,
    }, `preset ${command.preset}`, {
      print,
      startWorld: boot,
      onExit,
    });
  }
  if (command.kind === "rebuild") {
    try {
      const snapshot = fromSnapshot(await load(command.snapshotPath));
      const place = resolvePlace(process.env);
      return runWorld(snapshot.topology, {
        place,
        name: snapshot.name,
        allowSharedState: command.allowSharedState,
      }, "rebuilt from snapshot", {
        print,
        startWorld: boot,
        onExit,
      });
    } catch (error) {
      print(messageText(error));
      return 1;
    }
  }
  if (command.kind === "resume") {
    const path = resumeSnapshotPath(command.nameOrSnapshotPath);
    try {
      const text = await load(path);
      const restored = fromSnapshot(text);
      const summary = snapshotSummary(text);
      const resumed = await resume(text, { teardown: command.teardown });
      const lifecycle = command.teardown
        ? "Teardown requested; stopping resolved services."
        : "Attached mode: Ctrl-C detaches; the world keeps running.";
      printStarted(
        {
          name: resumed.name,
          topology: restored.topology,
          den: resumed.den,
          apps: resumed.apps,
        },
        "resumed from snapshot",
        summary.place,
        path,
        lifecycle,
        print,
      );
      if (command.teardown) {
        print(teardownSummary(resumed.name, await resumed.teardown()));
        return 0;
      }
      await onExit();
      await resumed.detach();
      print(`Detached from world ${JSON.stringify(resumed.name)}; it is still running.`);
      return 0;
    } catch (error) {
      print(messageText(error));
      return 1;
    }
  }
  if (command.kind === "list") {
    let names: string[];
    try {
      names = (await listDir(WORLDS_DIR)).filter((name) => name.endsWith(".json")).sort();
    } catch (error) {
      if (isMissingFile(error)) {
        print("No world snapshots. Start one with: pnpm world up solo");
        return 0;
      }
      print(messageText(error));
      return 1;
    }
    let printed = 0;
    for (const name of names) {
      const path = join(WORLDS_DIR, name);
      try {
        const summary = snapshotSummary(await load(path));
        print(`${summary.name}  ${summary.createdAt}  ${summary.place}  orgs ${joinedKeys(summary.orgs)}  apps ${joinedKeys(summary.apps)}${summary.sharedProductionState ? "  LIVE SHARED PRODUCTION STATE" : ""}`);
        printed += 1;
      } catch (error) {
        print(`Warning: skipped ${displayPath(path)}: ${messageText(error)}`);
      }
    }
    if (printed === 0 && names.length === 0) {
      print("No world snapshots. Start one with: pnpm world up solo");
    }
    return 0;
  }

  const path = join(WORLDS_DIR, `${command.name}.json`);
  try {
    await remove(path);
  } catch (error) {
    if (isMissingFile(error)) {
      print(`Snapshot ${displayPath(path)} does not exist.`);
    } else {
      print(messageText(error));
    }
    return 1;
  }
  print(`Removed snapshot ${displayPath(path)}. This only removes snapshot metadata; it does not stop detached services.`);
  return 0;
}
