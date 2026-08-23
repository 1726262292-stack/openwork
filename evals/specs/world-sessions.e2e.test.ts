import { readFile } from "node:fs/promises";
import { expect } from "vitest";
import { listSessions } from "@openwork/behaviors";
import { needs, soloWorkspace, startWorld, test } from "@openwork/testkit";

const titles: readonly string[] = ["Q3 report", "Invoice cleanup"];

test("a world declaratively seeds desktop sessions", { timeout: 300_000 }, async () => {
  needs({ optIn: ["OPENWORK_EVAL_WORLD_SESSIONS_E2E"] });

  await using world = await startWorld(soloWorkspace.with({
    apps: { main: { sessions: titles } },
  }));

  const observed = await listSessions(world.app("main"));
  for (const title of titles) {
    expect(observed.some((session) => session.title === title)).toBe(true);
  }

  const snapshot: unknown = JSON.parse(await readFile(world.snapshotPath, "utf8"));
  expect(snapshot).toMatchObject({
    resolved: {
      apps: {
        main: { sessions: [...titles] },
      },
    },
  });
});
