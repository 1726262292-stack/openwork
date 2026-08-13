import { expect, test } from "bun:test";

import { parseLibraryPayload } from "../app/(den)/dashboard/_components/library-data";

test("parses Remote MCP Apps as first-class Library items", () => {
  expect(parseLibraryPayload({
    items: [{
      type: "app",
      id: "cob_01kzzzzzzzzzzzzzzzzzzzzzzz",
      pluginId: "plg_01kzzzzzzzzzzzzzzzzzzzzzzz",
      name: "Project Atlas",
      description: "Portable dashboard",
      sourceUrl: "https://example.test/project-atlas.html",
      status: "active",
      activeVersionId: "cov_01kzzzzzzzzzzzzzzzzzzzzzzz",
      state: "ready",
      edges: [{ kind: "org_wide" }],
      role: "viewer",
    }],
  })).toEqual([{
    type: "app",
    id: "cob_01kzzzzzzzzzzzzzzzzzzzzzzz",
    pluginId: "plg_01kzzzzzzzzzzzzzzzzzzzzzzz",
    name: "Project Atlas",
    description: "Portable dashboard",
    sourceUrl: "https://example.test/project-atlas.html",
    status: "active",
    activeVersionId: "cov_01kzzzzzzzzzzzzzzzzzzzzzzz",
    state: "ready",
    edges: [{ kind: "org_wide" }],
    role: "viewer",
  }]);
});
