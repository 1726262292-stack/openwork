/**
 * Bun test preload: isolate all on-disk state to a per-process temp dir so tests never
 * touch the real `~/.config/openwork` or `~/.openwork`.
 *
 * Registered via bunfig.toml `[test] preload`. Tests that pass an explicit
 * `config.configPath` still get their own DB at `<configDir>/openwork.db`; tests without
 * one fall back to this isolated temp DB instead of the user's real config dir.
 */
import { afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "openwork-test-state-"));

process.env.OPENWORK_DB ??= join(dir, "openwork.db");
process.env.OPENWORK_DATA_DIR ??= join(dir, "openwork-data");
process.env.OPENWORK_TOKEN_STORE ??= join(dir, "tokens.json");
process.env.OPENWORK_ENV_STORE ??= join(dir, "env.json");

const { resetDbForTests } = await import("./db.js");

afterEach(() => {
  resetDbForTests();
});
