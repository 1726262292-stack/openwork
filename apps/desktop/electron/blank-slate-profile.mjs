import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BLANK_SLATE_FLAG = "--blank-slate";

export function resolveBlankSlateLaunch({ argv, appName }) {
  if (!argv.includes(BLANK_SLATE_FLAG)) {
    return { enabled: false, appName, userDataPath: null };
  }

  return {
    enabled: true,
    appName: `${appName} - Test profile`,
    userDataPath: mkdtempSync(path.join(tmpdir(), "openwork-test-profile-")),
  };
}
