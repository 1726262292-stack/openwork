import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createChatsStore } from "./chats-store.mjs";

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function createStoreRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "openwork-chats-store-"));
  const userData = path.join(root, "userData");
  return {
    root,
    userData,
    store: createChatsStore({ app: { getPath: (name) => name === "userData" ? userData : root } }),
  };
}

test("resolves default chat root deterministically in dev mode", async () => {
  const { store, userData } = await createStoreRoot();
  const previousDevMode = process.env.OPENWORK_DEV_MODE;
  const previousHome = process.env.HOME;
  process.env.OPENWORK_DEV_MODE = "1";
  process.env.HOME = path.join(userData, "first-home");
  try {
    assert.equal(
      store.chatsRootDefault(),
      path.join(userData, "openwork-dev-data", "home", "OpenWork", "chats"),
    );
    process.env.HOME = path.join(userData, "second-home");
    assert.equal(
      store.chatsRootDefault(),
      path.join(userData, "openwork-dev-data", "home", "OpenWork", "chats"),
    );
  } finally {
    restoreEnv("OPENWORK_DEV_MODE", previousDevMode);
    restoreEnv("HOME", previousHome);
  }
});

test("resolves packaged default chat root from the user home", async () => {
  const { root, store } = await createStoreRoot();
  const previousDevMode = process.env.OPENWORK_DEV_MODE;
  const previousHome = process.env.HOME;
  const home = path.join(root, "home");
  delete process.env.OPENWORK_DEV_MODE;
  process.env.HOME = home;
  try {
    assert.equal(store.chatsRootDefault(), path.join(home, "OpenWork", "chats"));
  } finally {
    restoreEnv("OPENWORK_DEV_MODE", previousDevMode);
    restoreEnv("HOME", previousHome);
  }
});

test("sanitizes chat folder slugs with Windows-safe reserved names", async () => {
  const { root, store } = await createStoreRoot();
  await store.setChatsRoot(path.join(root, "chats"));

  assert.equal((await store.prepareChatFolder({ name: "CON" })).slug, "chat-con");
  assert.equal((await store.prepareChatFolder({ name: "COM1 2" })).slug, "chat-com1-2");
  assert.equal((await store.prepareChatFolder({ name: "Quarterly Plan" })).slug, "quarterly-plan");
  assert.equal((await store.prepareChatFolder({ name: "spaces_and__CAPS" })).slug, "spaces-and-caps");
  assert.equal((await store.prepareChatFolder({ name: "💬 Привет 🚀" })).slug, "new-chat");
});

test("dedupes existing chat folders with numeric suffixes", async () => {
  const { root, store } = await createStoreRoot();
  const chatsRoot = path.join(root, "chats");
  await mkdir(path.join(chatsRoot, "new-chat"), { recursive: true });
  await mkdir(path.join(chatsRoot, "new-chat-2"), { recursive: true });
  await store.setChatsRoot(chatsRoot);

  const prepared = await store.prepareChatFolder();
  assert.equal(prepared.slug, "new-chat-3");
  assert.equal(prepared.path, path.join(chatsRoot, "new-chat-3"));
});

test("persists, reads, and clears the chat root override", async () => {
  const { root, userData, store } = await createStoreRoot();
  const chatsRoot = path.join(root, "custom-chats");
  const setConfig = await store.setChatsRoot(chatsRoot);
  assert.equal(setConfig.root, chatsRoot);
  assert.equal(setConfig.isDefault, false);

  const persisted = JSON.parse(await readFile(path.join(userData, "openwork-chats.json"), "utf8"));
  assert.equal(persisted.chatsRoot, chatsRoot);

  const reloaded = createChatsStore({ app: { getPath: (name) => name === "userData" ? userData : root } });
  assert.equal((await reloaded.getChatsConfig()).root, chatsRoot);

  const cleared = await reloaded.setChatsRoot(null);
  assert.equal(cleared.root, reloaded.chatsRootDefault());
  assert.equal(cleared.isDefault, true);
});

test("prepareChatFolder creates and verifies the directory on disk", async () => {
  const { root, store } = await createStoreRoot();
  const chatsRoot = path.join(root, "chats");
  await store.setChatsRoot(chatsRoot);

  const prepared = await store.prepareChatFolder({ name: "Demo Chat" });
  assert.equal(prepared.slug, "demo-chat");
  assert.equal(prepared.root, chatsRoot);
  assert.equal(prepared.displayPath, prepared.path);

  const stats = await import("node:fs/promises").then((fs) => fs.stat(prepared.path));
  assert.equal(stats.isDirectory(), true);
});
