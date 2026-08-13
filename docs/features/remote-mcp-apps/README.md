# Remote MCP Apps

Remote MCP Apps let a person publish a portable MCP App as one self-contained
HTML file, import it into the OpenWork Library by URL, and bind its declared
read-only capabilities to MCP connections already managed by OpenWork Connect.

The published URL is an import source, not a runtime origin. OpenWork stores the
exact HTML and normalized manifest in an immutable encrypted config-object
revision, identifies it by SHA-256, and serves it from a versioned `ui://`
resource. A cached revision therefore remains usable and downloadable if the
publisher moves or removes the original file.

## Authoring contract

Any frontend stack can author an app. React and Vite are build-time choices;
React source is not the runtime protocol and OpenWork does not server-render
the app. The published artifact must be a complete UTF-8 HTML document no
larger than 768 KiB with all JavaScript, CSS, images, fonts, and the MCP Apps
client SDK inlined.

The document must contain exactly one manifest:

```html
<script type="application/json" id="openwork-mcp-app">
{
  "schemaVersion": "openwork.remote-mcp-app/1",
  "name": "Project Explorer",
  "version": "1.0.0",
  "description": "Browse projects from an authorized connection.",
  "launchTool": {
    "title": "Open Project Explorer",
    "description": "Open the project explorer."
  },
  "capabilities": [
    {
      "key": "projects",
      "title": "Project search",
      "description": "Search the connected project catalog.",
      "toolName": "search_projects",
      "access": "read",
      "required": true
    }
  ]
}
</script>
```

Capability keys must be unique. This first contract accepts only `read`
capabilities. During import, OpenWork requires the selected live provider tool
to advertise `readOnlyHint: true`, rejects destructive tools, applies the
connection's tool policy, and records the current input-schema digest.

A Vite build can use a single-file output plugin or an equivalent post-build
step. The resulting HTML must not reference external scripts, stylesheets,
preloads, images, media, frames, CSS URLs, or imports. The app must use the
standard `@modelcontextprotocol/ext-apps` client bridge and complete the MCP
Apps handshake. It receives the launch result through the standard tool-result
notification.

The launch result has this shape:

```json
{
  "schemaVersion": "openwork.remote-mcp-app-launch/1",
  "app": {
    "id": "cob_...",
    "name": "Project Explorer",
    "version": "1.0.0",
    "revisionId": "cov_...",
    "resourceDigest": "sha256:..."
  },
  "capabilities": [
    {
      "key": "projects",
      "title": "Project search",
      "toolName": "remote_app_..._...",
      "argumentsField": "arguments",
      "bound": true
    }
  ]
}
```

The app calls only the returned proxy tool name, passing the downstream MCP
arguments under `arguments`. It must not assume a stable proxy name or know an
OpenWork connection ID. OpenWork invokes the exact bound downstream tool and
returns provider data in `structuredContent` using
`openwork.remote-mcp-app-capability-result/1`. Credentials never enter the HTML
or launch result.

## Installation and lifecycle

1. In Den Web, open Library and choose **Add remote MCP App**.
2. Paste the published HTML URL. OpenWork downloads it through the guarded URL
   fetcher, validates portability and the embedded manifest, and shows the
   resolved source, byte size, digest, and requested capabilities.
3. Map every required capability to an authorized OpenWork Connect connection.
4. Import and activate. The app becomes a first-class **App** item in the same
   Library contract as Programs, plugins, and connections. Like a Program, it
   remains a config object contained by its parent OpenWork Connect Plugin,
   with an immutable active revision and an exact launch tool.
5. A refresh downloads and caches a new draft without changing the active
   revision or its connection bindings. Activation and rollback are explicit.
   In this first contract, revisions may change UI and metadata but keep the
   same capability keys, downstream tool names, access, and required status;
   bindings are edited separately against the active contract.
6. Retirement removes the app from agent discovery and revokes binding-derived
   connection access without deleting revisions. Restore revalidates the live
   capability catalog before making the app available again.

Managers can use the existing plugin sharing surface to grant app access to
people, teams, or the organization. Viewers can discover the app through the
agent MCP and download revisions they can access. Editors can update bindings
and revisions; managers also control sharing and retirement.

## MCP Apps provider contract

For every visible active installation, the agent MCP:

- advertises `text/html;profile=mcp-app` support through the standard MCP Apps
  extension;
- registers a deterministic launch tool whose `_meta.ui.resourceUri` is the
  exact active revision URI;
- registers every retained revision as an immutable resource at
  `ui://openwork/library-apps/{appId}/revisions/{revisionId}/index.html`;
- returns the cached HTML with an empty connect/resource/frame/base URI CSP and
  its SHA-256 digest in resource metadata;
- returns launch-time app and capability mappings through `structuredContent`;
- registers bound capability proxies as app-visible rather than model-visible;
- repeats the authorization, tool-policy, schema, and strict read-only checks
  at execution time.

The current agent endpoint is stateless per HTTP request, so every
`tools/list`, `tools/call`, `resources/list`, and `resources/read` request sees
the current Library state without requiring a persistent-session
`tools/list_changed` notification. Retirement and restore are consequently
visible on the next catalog request. A host that caches a catalog for the life
of its connection must reconnect or refresh that MCP connection after Library
changes. Remote MCP Apps are independent of the `codemodeScripts` feature flag;
Code Mode is not required for import, discovery, rendering, or capability
execution. Agent discovery remains fail-closed until the operator enables
`DEN_REMOTE_MCP_APPS_ENABLED` after a compatible Desktop MCP Apps host release
has been deployed.

## Security and portability limits

- Hosted source URLs must use HTTP or HTTPS, may not include credentials,
  fragments, or sensitive query parameters, and pass the existing SSRF-safe
  redirect and address checks. Loopback HTTP is limited to development mode.
- Import is bounded to 15 seconds and 768 KiB. Invalid UTF-8 and partial or
  externally dependent documents fail closed.
- The cached MCP App resource declares no network, subframe, external resource,
  or base-URI permissions. OpenWork Desktop applies its own opaque sandbox,
  payload-size, teardown, and error-containment rules described in the MCP Apps
  host feature documentation.
- Only live tools that remain strictly read-only are callable from imported
  apps. Changes in visibility, policy, annotations, or schema are detected
  before activation or execution.
- The source URL and app bytes are separate from artifact/tool data. Runtime
  data comes only from the launch result and scoped capability tool results.
