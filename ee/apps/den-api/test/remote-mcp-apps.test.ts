import { expect, test } from "bun:test"

process.env.DEN_DB_ENCRYPTION_KEY ??= "x".repeat(32)
process.env.BETTER_AUTH_SECRET ??= "y".repeat(32)
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3005"
process.env.OPENWORK_DEV_MODE ??= "1"
process.env.DATABASE_URL ??= "mysql://root:password@127.0.0.1:3306/openwork_den"

const { inspectRemoteMcpAppHtml, REMOTE_MCP_APP_MAX_BYTES } = await import("../src/remote-mcp-apps.js")

function appHtml(extra = "") {
  return `<!doctype html><html><head><style>body{font:14px sans-serif}</style></head><body><main id="app"></main>${extra}<script type="application/json" id="openwork-mcp-app">${JSON.stringify({
    schemaVersion: "openwork.remote-mcp-app/1",
    name: "Project Explorer",
    version: "1.0.0",
    description: "Browse connected projects.",
    capabilities: [{
      key: "project-search",
      title: "Project search",
      toolName: "search_projects",
      access: "read",
      required: true,
    }],
  })}</script><script>document.querySelector('#app').textContent='Ready'</script></body></html>`
}

test("accepts a self-contained HTML app and extracts its portable manifest", () => {
  const html = appHtml()
  const inspected = inspectRemoteMcpAppHtml(html)
  expect(inspected.manifest).toMatchObject({
    schemaVersion: "openwork.remote-mcp-app/1",
    name: "Project Explorer",
    capabilities: [{ key: "project-search", access: "read", toolName: "search_projects" }],
  })
  expect(inspected.byteSize).toBe(Buffer.byteLength(html))
  expect(inspected.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
})

test("recognizes HTML-whitespace and ignored attributes on script end tags", () => {
  const html = appHtml().replace("</script><script>", "</script\t\n ignored><script>")
  expect(inspectRemoteMcpAppHtml(html).manifest.name).toBe("Project Explorer")
})

test("rejects runtime resource dependencies instead of caching a partially portable app", () => {
  expect(() => inspectRemoteMcpAppHtml(appHtml('<script src="https://cdn.example/app.js"></script>')))
    .toThrow("self-contained HTML file")
  expect(() => inspectRemoteMcpAppHtml(appHtml('<script\tsrc="https://cdn.example/app.js"></script\t\n ignored>')))
    .toThrow("self-contained HTML file")
  expect(() => inspectRemoteMcpAppHtml(appHtml('<link rel="stylesheet" href="./app.css">')))
    .toThrow("self-contained HTML file")
  expect(() => inspectRemoteMcpAppHtml(appHtml('<img src="/logo.png">')))
    .toThrow("self-contained HTML file")
  expect(() => inspectRemoteMcpAppHtml(appHtml('<iframe srcdoc="<p>nested</p>"></iframe>')))
    .toThrow("self-contained HTML file")
})

test("rejects manifests that request writes or duplicate capability keys", () => {
  const writeManifest = appHtml().replace('"access":"read"', '"access":"write"')
  expect(() => inspectRemoteMcpAppHtml(writeManifest)).toThrow("Invalid input")

  const duplicated = appHtml().replace(
    '"required":true}',
    '"required":true},{"key":"project-search","toolName":"list_projects","access":"read","required":true}',
  )
  expect(() => inspectRemoteMcpAppHtml(duplicated)).toThrow("duplicated")
})

test("uses the desktop MCP App host's exact resource byte ceiling", () => {
  expect(REMOTE_MCP_APP_MAX_BYTES).toBe(768 * 1024)
})
