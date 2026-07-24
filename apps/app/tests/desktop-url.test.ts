import { describe, expect, test } from "bun:test";

import { normalizeBrowserOpenFailureMessage } from "../src/app/lib/desktop";
import { t } from "../src/i18n";

const friendly = t("app.error_browser_open_failed_action");

describe("normalizeBrowserOpenFailureMessage", () => {
  test("maps Windows no-handler HRESULT failures to browser copy fallback", () => {
    const detail = "Failed to open: Aplicativo não encontrado (0x800401F5)";
    const message = normalizeBrowserOpenFailureMessage(detail);

    expect(message).toContain(friendly);
    expect(message).toContain(detail);
  });

  test("maps localized no-handler failures by HRESULT without English text", () => {
    const detail = "Aplicativo não encontrado (0x800401F5)";
    const message = normalizeBrowserOpenFailureMessage(detail);

    expect(message).toContain(friendly);
    expect(message).toContain(detail);
  });

  test("maps openExternal timeouts and keeps diagnostics", () => {
    const detail = "timed out after 4000ms";
    const message = normalizeBrowserOpenFailureMessage(detail);

    expect(message).toContain(friendly);
    expect(message).toContain(detail);
  });

  test("maps forced openExternal failures and keeps diagnostics", () => {
    const detail = "simulated failure";
    const message = normalizeBrowserOpenFailureMessage(detail, true);

    expect(message).toContain(friendly);
    expect(message).toContain(detail);
  });
});
