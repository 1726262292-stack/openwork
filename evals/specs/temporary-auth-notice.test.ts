import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { test } from "@openwork/testkit";
import {
  TEMPORARY_AUTH_NOTICE_EXPIRES_AT,
  shouldShowTemporaryAuthNotice,
} from "../../ee/apps/den-web/app/(den)/_lib/temporary-auth-notice";

const authScreenPath = fileURLToPath(
  new URL("../../ee/apps/den-web/app/(den)/_components/auth-screen.tsx", import.meta.url),
);
const noticePath = fileURLToPath(
  new URL("../../ee/apps/den-web/app/(den)/_components/temporary-auth-notice.tsx", import.meta.url),
);

test("sign-in and sign-up temporarily explain how to recover after the authentication change", async ({ evidence }) => {
  const authScreen = readFileSync(authScreenPath, "utf8");
  const notice = readFileSync(noticePath, "utf8");

  expect(authScreen).toContain("<TemporaryAuthNotice />");
  expect(authScreen).toContain("<AuthPanel bare emailFirstFlow />");
  expect(notice).toContain("We recently changed our authentication system.");
  expect(notice).toContain("Chrome or Edge:");
  expect(notice).toContain("Safari:");
  expect(notice).toContain("Firefox or another browser:");
  expect(notice).toContain("Clearing site data signs you out.");

  expect(shouldShowTemporaryAuthNotice(TEMPORARY_AUTH_NOTICE_EXPIRES_AT - 1)).toBe(true);
  expect(shouldShowTemporaryAuthNotice(TEMPORARY_AUTH_NOTICE_EXPIRES_AT)).toBe(false);

  evidence.recordAssertionEvidence(
    "Hosted sign-in and sign-up show time-bounded authentication recovery guidance",
    "The shared email-first auth screen includes an apology and site-data recovery steps for Chrome/Edge, Safari, and Firefox/other browsers before the fixed expiry, then removes the notice at expiry.",
    true,
  );
});
