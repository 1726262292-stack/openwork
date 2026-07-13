import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InstallDownloadSpinner } from "../app/(den)/_components/install-download-spinner";

test("install download spinner exposes a stable animated loading affordance", () => {
  const markup = renderToStaticMarkup(<InstallDownloadSpinner />);

  expect(markup).toContain('data-testid="install-download-spinner"');
  expect(markup).toContain("animate-spin");
  expect(markup).toContain("animation-name:spin");
  expect(markup).toContain("animation-duration:1s");
  expect(markup).toContain("animation-timing-function:linear");
  expect(markup).toContain("animation-iteration-count:infinite");
});
