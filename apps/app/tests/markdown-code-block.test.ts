import { describe, expect, test } from "bun:test";

import { renderHighlightedMarkdownHtml, renderMarkdownHtml } from "../src/components/markdown/markdown";

const CODE = "const value = 1;\nconsole.log(value);";
const MARKDOWN = `\`\`\`ts\n${CODE}\n\`\`\``;

describe("markdown code blocks", () => {
  test("renders fallback code blocks with subtle theme-aware styling and copy affordance", () => {
    const html = renderMarkdownHtml(MARKDOWN);

    expect(html).toContain("data-openwork-code-block");
    expect(html).toContain("bg-gray-2/60");
    expect(html).toContain("data-openwork-code-copy");
    expect(html).toContain("data-openwork-code-copy-icon");
    expect(html).toContain("data-openwork-code-copy-check-icon");
    expect(html).toContain("h-7 w-7");
    expect(html).toContain('aria-label="Copy code block"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('title="Copy code block"');
    expect(html).not.toContain(">Copy</span>");
    expect(html).toContain("pt-11");
    expect(html).toContain(CODE.split("\n")[0]);
    expect(html).toContain(CODE.split("\n")[1]);
  });

  test("renders highlighted code blocks with the same copy affordance and dual Shiki themes", async () => {
    const html = await renderHighlightedMarkdownHtml(MARKDOWN);

    expect(html).toContain("data-openwork-code-block");
    expect(html).toContain("data-openwork-shiki");
    expect(html).toContain("data-openwork-code-copy");
    expect(html).toContain("data-openwork-code-copy-icon");
    expect(html).toContain("data-openwork-code-copy-check-icon");
    expect(html).toContain("--shiki-dark");
    expect(html).toContain("github-light");
    expect(html).toContain("github-dark");
  });
});
