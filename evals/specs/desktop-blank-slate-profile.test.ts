import { tmpdir } from "node:os";
import { expect } from "vitest";
import { test } from "@openwork/testkit";
import { resolveBlankSlateLaunch } from "../../apps/desktop/electron/blank-slate-profile.mjs";

test("any desktop build can launch with an isolated blank-slate profile", async ({ evidence }) => {
  const normal = resolveBlankSlateLaunch({ argv: [], appName: "OpenWork Enterprise" });
  expect(normal).toEqual({ enabled: false, appName: "OpenWork Enterprise", userDataPath: null });

  const first = resolveBlankSlateLaunch({ argv: ["--blank-slate"], appName: "OpenWork Enterprise" });
  const second = resolveBlankSlateLaunch({ argv: ["--blank-slate"], appName: "OpenWork Enterprise" });

  expect(first.enabled).toBe(true);
  expect(first.appName).toBe("OpenWork Enterprise - Test profile");
  expect(first.userDataPath).toContain(tmpdir());
  expect(first.userDataPath).not.toBe(second.userDataPath);
  expect(first.userDataPath).not.toContain("com.differentai.openwork");

  evidence.fact(
    "Blank-slate launches cannot read or overwrite the installed profile",
    "Each --blank-slate launch receives a unique OS-temporary user-data directory while a normal launch remains unchanged.",
    true,
  );
  evidence.fact(
    "The isolated app is visibly identified",
    "The desktop window name is suffixed with Test profile for every distribution flavor.",
    true,
  );
});
