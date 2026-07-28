import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { denStackDown } from "./den-stack.ts";
import { manifestPath, readEnvManifest, writeEnvManifest } from "./env-manifest.ts";
import { createLocalHost, killLocalPid } from "./hosts/local.ts";
import type { EnvManifest } from "./env-manifest.ts";
import type { DenServiceHandle, ElectronSurfaceOptions, Host, SurfaceHandle } from "./hosts/types.ts";
import type { LocalHostOptions } from "./hosts/local.ts";

type OrgMode = "single_org" | "multi_org";
type SeedMode = "acme" | "none";
type DelegateMode = "automation" | "demo";

export type OwtArgs =
  | { command: "help"; topic?: string }
  | UpArgs
  | ShareArgs
  | DownArgs
  | DelegateArgs;

export interface UpArgs {
  command: "up";
  name: string;
  den: boolean;
  orgMode: OrgMode | null;
  seed: SeedMode | null;
  electrons: string[];
  chromes: string[];
  denBaseUrl: string | null;
  denApiBaseUrl: string | null;
}

export interface ShareArgs {
  command: "share";
  name: string;
}

export interface DownArgs {
  command: "down";
  name: string;
  stack: boolean;
}

export interface DelegateArgs {
  command: "run" | "proof";
  name: string;
  rest: string[];
}

export interface OwtMainOptions {
  createHost?: (options: LocalHostOptions) => Host;
  evalMain?: (argv: string[]) => Promise<void>;
  now?: () => Date;
  print?: (message: string) => void;
}

const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(RUNNER_DIR, "..", "..");

function readRequiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function splitNames(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function parseOrgMode(value: string): OrgMode {
  if (value === "single_org" || value === "multi_org") return value;
  throw new Error(`Unknown --org-mode value: ${value}. Supported: single_org, multi_org.`);
}

function parseSeed(value: string): SeedMode {
  if (value === "acme" || value === "none") return value;
  throw new Error(`Unknown --seed value: ${value}. Supported: acme, none.`);
}

function parseShare(argv: string[]): ShareArgs | { command: "help"; topic: string } {
  let name = "default";
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--name") {
      name = readRequiredValue(argv, index, value);
      index += 1;
    } else if (value === "--help" || value === "-h") {
      return { command: "help", topic: "share" };
    } else {
      throw new Error(`Unknown share argument: ${value}`);
    }
  }
  return { command: "share", name };
}

function parseDown(argv: string[]): DownArgs | { command: "help"; topic: string } {
  let name = "default";
  let stack = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--name") {
      name = readRequiredValue(argv, index, value);
      index += 1;
    } else if (value === "--stack") {
      stack = true;
    } else if (value === "--help" || value === "-h") {
      return { command: "help", topic: "down" };
    } else {
      throw new Error(`Unknown down argument: ${value}`);
    }
  }
  return { command: "down", name, stack };
}

function parseDelegate(command: "run" | "proof", argv: string[]): DelegateArgs | { command: "help"; topic: string } {
  let name = "default";
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--name") {
      name = readRequiredValue(argv, index, value);
      index += 1;
    } else if (value === "--help" || value === "-h") {
      return { command: "help", topic: command };
    } else {
      rest.push(value);
    }
  }
  return { command, name, rest };
}

function parseUp(argv: string[]): UpArgs | { command: "help"; topic: string } {
  const args: UpArgs = {
    command: "up",
    name: "default",
    den: false,
    orgMode: null,
    seed: null,
    electrons: [],
    chromes: [],
    denBaseUrl: null,
    denApiBaseUrl: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--name") {
      args.name = readRequiredValue(argv, index, value);
      index += 1;
    } else if (value === "--den") {
      args.den = true;
    } else if (value === "--org-mode") {
      args.orgMode = parseOrgMode(readRequiredValue(argv, index, value));
      args.den = true;
      index += 1;
    } else if (value === "--seed") {
      args.seed = parseSeed(readRequiredValue(argv, index, value));
      args.den = true;
      index += 1;
    } else if (value === "--electron") {
      args.electrons.push(...splitNames(readRequiredValue(argv, index, value)));
      index += 1;
    } else if (value === "--chrome") {
      args.chromes.push(...splitNames(readRequiredValue(argv, index, value)));
      index += 1;
    } else if (value === "--den-base-url") {
      args.denBaseUrl = readRequiredValue(argv, index, value);
      index += 1;
    } else if (value === "--den-api-base-url") {
      args.denApiBaseUrl = readRequiredValue(argv, index, value);
      index += 1;
    } else if (value === "--help" || value === "-h") {
      return { command: "help", topic: "up" };
    } else {
      throw new Error(`Unknown up argument: ${value}`);
    }
  }
  if ((args.denBaseUrl && !args.denApiBaseUrl) || (!args.denBaseUrl && args.denApiBaseUrl)) {
    throw new Error("--den-base-url and --den-api-base-url must be provided together.");
  }
  return args;
}

export function parseArgs(argv: string[]): OwtArgs {
  const command = argv[0];
  const rest = argv.slice(1);
  if (!command || command === "--help" || command === "-h") return { command: "help" };
  if (command === "up") return parseUp(rest);
  if (command === "share") return parseShare(rest);
  if (command === "down") return parseDown(rest);
  if (command === "run" || command === "proof") return parseDelegate(command, rest);
  throw new Error(`Unknown owt command: ${command}. Supported: up, share, run, proof, down.`);
}

function printHelp(print: (message: string) => void, topic?: string): void {
  if (topic === "up") {
    print("Usage: pnpm owt up [--name default] [--den] [--org-mode single_org|multi_org] [--seed acme|none] [--electron a,b] [--chrome c,d] [--den-base-url <url> --den-api-base-url <url>]");
  } else if (topic === "share") {
    print("Usage: pnpm owt share [--name default]");
  } else if (topic === "run") {
    print("Usage: pnpm owt run [--name default] ...eval-args");
  } else if (topic === "proof") {
    print("Usage: pnpm owt proof [--name default] ...fraimz-args");
  } else if (topic === "down") {
    print("Usage: pnpm owt down [--name default] [--stack]");
  } else {
    print("Usage: pnpm owt <up|share|run|proof|down> [options]");
  }
}

async function phase<T>(label: string, print: (message: string) => void, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await run();
  } finally {
    print(`phase ${label}: ${Date.now() - startedAt}ms`);
  }
}

function addSurface(surfaces: Record<string, SurfaceHandle>, handle: SurfaceHandle): void {
  if (surfaces[handle.name]) throw new Error(`Duplicate surface name: ${handle.name}`);
  surfaces[handle.name] = handle;
}

function bootstrapFor(args: UpArgs, den: DenServiceHandle | null): ElectronSurfaceOptions["bootstrap"] {
  if (den) return { baseUrl: den.webUrl, apiBaseUrl: den.apiUrl, requireSignin: false };
  if (args.denBaseUrl && args.denApiBaseUrl) {
    return { baseUrl: args.denBaseUrl, apiBaseUrl: args.denApiBaseUrl, requireSignin: false };
  }
  return undefined;
}

function manifestDenHandle(den: DenServiceHandle): DenServiceHandle & { token?: string } {
  const entry: DenServiceHandle & { token?: string } = { ...den };
  const token = process.env.OPENWORK_EVAL_DEN_TOKEN?.trim();
  if (token) entry.token = token;
  return entry;
}

function printHandle(handle: SurfaceHandle, print: (message: string) => void): void {
  print(`${handle.kind} ${handle.name} CDP: ${handle.cdpUrl}`);
  if (handle.kind === "electron" && handle.meta?.log) {
    print(`${handle.kind} ${handle.name} log: ${handle.meta.log}`);
  }
}

async function handleUp(args: UpArgs, options: OwtMainOptions, print: (message: string) => void): Promise<void> {
  const createHost = options.createHost ?? createLocalHost;
  const host = createHost({ repoRoot: REPO_ROOT, log: (message) => print(`▸ ${message}`) });
  const surfaces: Record<string, SurfaceHandle> = {};
  const den = args.den
    ? await phase("den", print, () => {
      if (!host.startDen) throw new Error("Local host does not support Den.");
      return host.startDen({ orgMode: args.orgMode ?? undefined, seed: args.seed ?? "acme" });
    })
    : null;
  const bootstrap = bootstrapFor(args, den);

  for (const name of args.electrons) {
    const handle = await phase(`electron ${name}`, print, () => host.spawnElectron(name, { bootstrap }));
    addSurface(surfaces, handle);
  }
  for (const name of args.chromes) {
    const handle = await phase(`chrome ${name}`, print, () => host.spawnChrome(name));
    addSurface(surfaces, handle);
  }

  const manifest: EnvManifest = {
    name: args.name,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    defaultHostKind: "local",
    surfaces,
    env: {},
  };
  if (den) manifest.den = manifestDenHandle(den);
  const path = await writeEnvManifest(manifest);
  print(`Manifest: ${path}`);
  if (den) {
    print(`Den Web: ${den.webUrl}`);
    print(`Den API: ${den.apiUrl}`);
    print(`export OPENWORK_EVAL_DEN_API_URL=${den.apiUrl}`);
    print(`export OPENWORK_EVAL_DEN_WEB_URL=${den.webUrl}`);
    const token = process.env.OPENWORK_EVAL_DEN_TOKEN?.trim();
    if (token) print(`export OPENWORK_EVAL_DEN_TOKEN=${token}`);
  }
  for (const handle of Object.values(surfaces)) printHandle(handle, print);
  if (!den && Object.keys(surfaces).length === 0) print("No Den stack or surfaces requested; wrote an empty local manifest.");
  print(`Hint: pnpm owt run --name ${args.name} --flow <id>`);
}

async function handleShare(args: ShareArgs, print: (message: string) => void): Promise<void> {
  const manifest = await readEnvManifest(args.name);
  if (!manifest) throw new Error(`Env manifest not found: ${args.name}`);
  print(`Manifest: ${manifestPath(args.name)}`);
  if (manifest.den) {
    print(`Den Web: ${manifest.den.webUrl}`);
    print(`Den API: ${manifest.den.apiUrl}`);
  }
  for (const handle of Object.values(manifest.surfaces)) printHandle(handle, print);
}

async function handleDown(args: DownArgs, print: (message: string) => void): Promise<void> {
  const manifest = await readEnvManifest(args.name);
  if (manifest) {
    for (const handle of Object.values(manifest.surfaces)) {
      if (handle.hostKind === "local" && handle.pid !== undefined) {
        const killed = await killLocalPid(handle.pid);
        print(killed ? `Killed ${handle.kind} ${handle.name} (pid ${handle.pid})` : `Kept ${handle.kind} ${handle.name}: pid ${handle.pid} was not running`);
      } else {
        print(`Kept ${handle.kind} ${handle.name}: no local pid recorded`);
      }
    }
  } else {
    print(`Env manifest not found: ${args.name}`);
  }
  if (args.stack) {
    await denStackDown({ log: (message) => print(`▸ ${message}`) });
  }
  await rm(manifestPath(args.name), { force: true });
  print(`Deleted manifest: ${manifestPath(args.name)}`);
}

async function defaultEvalMain(argv: string[]): Promise<void> {
  const cli = await import("./cli.ts");
  await cli.main(argv);
}

async function handleDelegate(args: DelegateArgs, mode: DelegateMode, options: OwtMainOptions): Promise<void> {
  const evalMain = options.evalMain ?? defaultEvalMain;
  await evalMain(["--mode", mode, "--env", args.name, ...args.rest]);
}

export async function main(argv: string[] = process.argv.slice(2), options: OwtMainOptions = {}): Promise<void> {
  const print = options.print ?? ((message: string) => console.log(message));
  const args = parseArgs(argv);
  if (args.command === "help") {
    printHelp(print, args.topic);
    return;
  }
  if (args.command === "up") await handleUp(args, options, print);
  else if (args.command === "share") await handleShare(args, print);
  else if (args.command === "down") await handleDown(args, print);
  else if (args.command === "run") await handleDelegate(args, "automation", options);
  else await handleDelegate(args, "demo", options);
}
