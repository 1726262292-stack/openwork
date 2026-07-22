import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const EMPTY_CHATS_CONFIG = Object.freeze({});
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function parseFirstJsonObject(raw) {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          return { ok: true, value: JSON.parse(raw.slice(start, index + 1)) };
        } catch {
          return { ok: false, value: null };
        }
      }
    }
  }

  return { ok: false, value: null };
}

async function writeJsonFileAtomic(outputPath, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(content);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, outputPath);
}

async function readJsonFile(targetPath, fallback) {
  try {
    const raw = await readFile(targetPath, "utf8");
    try {
      return JSON.parse(raw);
    } catch (error) {
      const recovered = parseFirstJsonObject(raw);
      if (recovered.ok) {
        console.warn(`[json] recovered ${targetPath} from trailing invalid data`, error);
        await writeJsonFileAtomic(targetPath, recovered.value);
        return recovered.value;
      }
      throw error;
    }
  } catch {
    return fallback;
  }
}

function isDirectory(targetPath) {
  return stat(targetPath).then((stats) => stats.isDirectory()).catch(() => false);
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function slugifyChatName(name) {
  const base = typeof name === "string" && name.trim() ? name.trim() : "new-chat";
  let slug = base
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");

  if (!slug) slug = "new-chat";
  const reservedCheck = slug.replace(/-\d+$/g, "");
  if (WINDOWS_RESERVED_NAMES.has(reservedCheck)) {
    slug = `chat-${slug}`;
  }
  return slug.replace(/[.\s]+$/g, "") || "new-chat";
}

function displayPathForHome(targetPath) {
  const home = os.homedir();
  const normalizedHome = home.replace(/[/\\]+$/g, "");
  if (!normalizedHome) return targetPath;
  if (targetPath === normalizedHome) return "~";
  const homePrefix = `${normalizedHome}${path.sep}`;
  return targetPath.startsWith(homePrefix) ? path.join("~", targetPath.slice(homePrefix.length)) : targetPath;
}

export function createChatsStore({ app }) {
  function chatsRootDefault() {
    // Dev mode swaps process.env.HOME to the sandboxed dev-data home midway
    // through startup (runtime.mjs buildChildEnv -> Object.assign(process.env)),
    // which changes what os.homedir() returns. Resolve the dev-data home
    // deterministically so early and late IPC reads target the same folder.
    if (process.env.OPENWORK_DEV_MODE === "1") {
      return path.join(app.getPath("userData"), "openwork-dev-data", "home", "OpenWork", "chats");
    }
    return path.join(os.homedir(), "OpenWork", "chats");
  }

  function chatsStatePath() {
    return path.join(app.getPath("userData"), "openwork-chats.json");
  }

  async function readChatsState() {
    const state = await readJsonFile(chatsStatePath(), EMPTY_CHATS_CONFIG);
    return state && typeof state === "object" ? state : EMPTY_CHATS_CONFIG;
  }

  async function getChatsConfig() {
    const state = await readChatsState();
    const storedRoot = typeof state.chatsRoot === "string" ? state.chatsRoot.trim() : "";
    const defaultRoot = chatsRootDefault();
    const root = storedRoot && path.isAbsolute(storedRoot) ? storedRoot : defaultRoot;
    const isDefault = root === defaultRoot;
    return { root, isDefault, displayRoot: displayPathForHome(root) };
  }

  async function setChatsRoot(rootOrNull) {
    const root = typeof rootOrNull === "string" ? rootOrNull.trim() : "";
    if (!root) {
      await writeJsonFileAtomic(chatsStatePath(), {});
      return getChatsConfig();
    }
    if (!path.isAbsolute(root)) {
      throw new Error("Chats location must be an absolute path.");
    }
    await writeJsonFileAtomic(chatsStatePath(), { chatsRoot: path.resolve(root) });
    return getChatsConfig();
  }

  async function prepareChatFolder(input = {}) {
    const config = await getChatsConfig();
    await mkdir(config.root, { recursive: true });
    if (!(await isDirectory(config.root))) {
      throw new Error(`Chats location is not a directory: ${config.root}`);
    }

    const baseSlug = slugifyChatName(input?.name);
    let slug = baseSlug;
    let counter = 2;
    while (await pathExists(path.join(config.root, slug))) {
      slug = `${baseSlug}-${counter}`;
      counter += 1;
    }

    const dir = path.join(config.root, slug);
    await mkdir(dir, { recursive: true });
    if (!(await isDirectory(dir))) {
      throw new Error(`Chat folder was not created: ${dir}`);
    }
    return { path: dir, slug, root: config.root, displayPath: displayPathForHome(dir) };
  }

  return {
    chatsRootDefault,
    getChatsConfig,
    setChatsRoot,
    prepareChatFolder,
  };
}
