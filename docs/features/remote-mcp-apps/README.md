# Remote MCP Apps

OpenWork renders MCP Apps as MCP Apps. A server advertises the stable
`io.modelcontextprotocol/ui` extension, a tool binds an exact UI resource with
`_meta.ui.resourceUri`, the host reads that resource with `resources/read`, and
tool inputs and results move over the standard MCP Apps bridge.

There are two distribution paths:

1. A normal MCP server added through OpenWork Connect. This is the primary
   path for an app that has tools. Model-visible provider operations are
   discovered and executed only through `search_capabilities` and
   `execute_capability`. OpenWork exposes a separate endpoint containing only
   UI-bound tools, forced to app-only visibility, and their exact resources
   only to the local App-host transport. Ordinary MCP clients receive an empty
   per-provider catalog, so rendering keeps the provider's same-server MCP Apps
   boundary without projecting its catalog into the model request.
2. A self-contained HTML file imported by URL. This is a convenience adapter
   for an externally authored app bundle. OpenWork caches the bytes, exposes
   one standard MCP launch tool and immutable `ui://` resources, and exposes
   the existing OpenWork capability-search gateway on that same MCP server.
   The sandboxed app can search and execute authorized Connect tools and Code
   Mode Programs without receiving credentials or direct cross-server access.

Programs remain executable `script` config objects. A Program's generated
views are MCP resources, but turning a view into a resource does not turn
Program execution into resource loading.

## Standard MCP server path

Connect continues to own server configuration, authentication, access grants,
per-member credentials, and tool policy. The OpenWork Cloud control server
publishes a member-scoped resource at:

```text
openwork://connect/mcp-servers/index.json
```

Desktop reads that resource with the member's existing Cloud MCP bearer
configuration and advertises the `mcp-app-host-v1` client capability. Den
returns a non-empty provider index only when that client capability and both
rollout gates are present. Desktop persists the capability on each reconciled
provider entry, which lets Den distinguish the bounded model/App-host split
from a previously released client. A connection is proxied at:

```text
/mcp/agent/connections/{connectionId}
```

For an ordinary MCP client, the proxy returns no tools or resources and rejects
direct calls. Desktop's local App host marks its transport as the app-host
audience; only that transport receives tools with a valid
`_meta.ui.resourceUri`, forced to `app` visibility, plus app-only
`search_capabilities` and `execute_capability` scoped to the originating
server. A regular MCP App can therefore discover and use its server's ordinary
tools without placing either ordinary or launch tools in the model request.
The app-host view preserves:

- the App tool's exact name, input/output schemas, annotations, and UI binding;
- concrete resource descriptors and `resources/read` content only for
  resources bound by the exposed App tools;
- `content`, `structuredContent`, `_meta`, and `isError` from `tools/call`;
- the stable MCP Apps extension, `ui://` URIs, and
  `text/html;profile=mcp-app` resources;
- one server identity per Connect connection, preventing name collisions and
  preserving the MCP Apps same-server tool-call boundary.

For deployment-order compatibility, a previously released Desktop that lacks
the capability marker retains the provider endpoint behavior it already had
until it upgrades. This avoids removing tools during a Den-first rollout. That
compatibility path is still behind the deployment and organization gates,
which both default off; capable clients never receive the provider catalog in
their model-facing transport.

OpenWork access grants and disabled-tool policy still apply at the proxy
boundary. Ordinary tools from the same connected MCP remain available through
capability search and execution but never appear on this endpoint. The proxy
deliberately advertises `listChanged: false` because the
current enterprise connector opens bounded request sessions rather than a
durable downstream notification stream. Catalog refresh therefore happens on
Connect reconciliation, Desktop startup, engine refresh, or an explicit Cloud
MCP refresh. Forwarding downstream list-change notifications is follow-up
interoperability work, not a custom substitute protocol.

## Static URL adapter

Any frontend stack can author the bundle. React and Vite are build-time
choices; React source is not the runtime protocol and OpenWork does not perform
React SSR. The import artifact is a complete UTF-8 HTML document no larger than
768 KiB with its JavaScript, CSS, images, fonts, and MCP Apps client code
inlined.

No OpenWork-specific embedded manifest is required. OpenWork derives display
metadata from the document `<title>` and optional description meta tag, then
uses the SHA-256 digest as the revision version. The source URL is an import
source, never the runtime origin.

The model-visible `import_remote_mcp_app` tool accepts only an existing Plugin
id, a public HTTPS URL, and an activation choice. Its
`_meta.ui.visibility: ["model"]` makes it unavailable to sandboxed apps. The
generic capability gateway also excludes the REST installation operation, so
an app or Program cannot bypass that boundary. Inline HTML, React or JavaScript
source, and build-project contents are not accepted.

The server-side downloader validates every redirect with the hosted SSRF
guard, requires an HTML MIME type and UTF-8 encoding, enforces a 15-second
timeout and 768 KiB ceiling, and rejects credential-bearing URLs. The static
adapter rejects external scripts, stylesheets, preloads, images,
media, frames, CSS URLs/imports, embedded CSP, and base-URI changes. It stores:

- exact HTML bytes in an immutable encrypted config-object revision;
- source and final redirect URLs, fetch time, and response content type;
- byte size, SHA-256 digest, validation diagnostics, and a closed CSP;
- an explicitly selected active revision plus retained rollback revisions.

For each visible active installation, OpenWork registers one deterministic
app-only launch binding with nested `_meta.ui.resourceUri`, discovers it
through capability search, and exposes every retained revision at:

```text
ui://openwork/library-apps/{appId}/revisions/{revisionId}/index.html
```

The launch result uses ordinary `structuredContent` for the app identity,
revision, digest, optional input, and the exact names of the existing
`search_capabilities` and `execute_capability` tools. Both gateway tools are
app-visible on the originating OpenWork server. Search returns ordinary
structured matches for authorized Connect tools and, when Code Mode is
enabled by organization policy, Programs as marketplace `script` capabilities.
Execution accepts the exact returned capability name and returns ordinary MCP
content and `structuredContent`. Programs remain durable resources and execute
server-side through the existing Program runtime.

The URL downloader and semantic search facade are OpenWork installation and
gateway behavior, not new MCP protocol primitives. Runtime communication is
standard same-server MCP Apps `tools/call`. OpenWork does not let the iframe
contact another MCP server or receive its credentials. Apps distributed with
their own MCP server keep using that server's native tools and should be added
through Connect without conversion.

## Authoring and execution contract

The public [Project Atlas example](https://github.com/reachjalil/openwork-remote-mcp-app-example)
is an open-source Vite/React repository with:

- normal local `dev`, `build`, `start:mcp`, and verification commands;
- mock data so an author or coding agent can iterate without OpenWork;
- a reproducible single-file production bundle for the static adapter;
- a standard MCP server fixture that advertises its render tool, UI resource,
  render-time structured data, and app-visible same-server tools.

Its GitHub Pages bundle is installable from
`https://reachjalil.github.io/openwork-remote-mcp-app-example/index.html`.

The execution contract is intentionally portable:

- local development may provide mock tool results directly to the UI;
- production MCP execution supplies input and results through the MCP Apps
  bridge;
- an imported app searches the advertised same-server gateway and executes an
  exact authorized Connect tool or Program result;
- credentials remain in the MCP host/Connect connection and never enter the
  HTML resource;
- an app calls only tools from its originating MCP server;
- the host enforces visibility, workspace denies, and user approval for
  non-read-only calls;
- the source bundle, tool data, and retained Program/Artifact data remain
  separate objects.

## Installation and lifecycle

For a standard server, add or install the MCP through OpenWork Connect and
grant the intended members or teams access. Desktop reconciles the authorized
server endpoint, agents discover its capabilities through the central search
and execute gateway, and UI tools render without an OpenWork-specific import
step or a model-visible provider catalog.

For a static bundle, an agent can install it through OpenWork Connect:

1. The user selects the existing Plugin that will contain and govern the App.
2. The agent calls `import_remote_mcp_app` with that Plugin id and a public
   HTTPS URL. Normal mutation approval applies because this installs executable
   third-party content.
3. OpenWork performs guarded download and portability validation, stores the
   exact digest-addressed revision, and activates it unless asked not to.
4. The adapter appears as an App inside its selected Plugin and shares through
   the existing Plugin/Marketplace access model. Den Web remains the user-facing
   preview, revision, activation, rollback, download, and lifecycle surface.
5. Refresh caches a new immutable draft without changing the active revision.
6. Activate or roll back explicitly. Retire removes the launch tool from agent
   discovery without deleting cached revisions; restore re-exposes the active
   revision.
7. Download always returns the exact cached HTML revision, so the installed
   copy remains usable after the source URL disappears.

Successful installation emits `notifications/tools/list_changed` and
`notifications/resources/list_changed`. Lifecycle mutations made through the
same MCP capability gateway emit the same notifications; every subsequent
list request is rebuilt from the current authorized Library state.

Native provider MCP Apps and the static adapter fail closed behind two explicit
gates: the deployment operator must set `DEN_REMOTE_MCP_APPS_ENABLED=true`, and
a platform admin must enable **Native MCP Apps (preview)** for the organization
in Den admin settings. Both gates default off. `DEN_GENERATED_ARTIFACT_VIEWS_ENABLED` remains off by default;
while it is off, generated-view creation, source submission, React compilation,
revision activation, resources, and launch tools are absent or rejected even
if records already exist. This flag is independent from `codemodeScripts`:
Programs remain usable by imported apps according to organization policy.
When either gate is off, a normal connected MCP's tools remain usable through
ordinary `search_capabilities` and `execute_capability`, but OpenWork removes
their MCP App classification and launch metadata, publishes no provider App
endpoint in the member index, and renders no App UI.

## Host security and compatibility

Desktop negotiates the stable extension, resolves the current tool definition,
reads the exact `ui://` resource even when it is absent from `resources/list`,
accepts text or base64 HTML, enforces MIME and size limits, validates CSP
origins, and loads the document through the isolated sandbox proxy. It sends
tool input and the complete preserved tool result after initialization, bounds
size changes, tears the bridge down on unmount, and contains resolution,
handshake, document, and runtime failures without hiding the normal tool
result.

App-requested tools are resolved only on the originating server and must be
visible to the app. When a tool carries `_meta.ui.resourceUri`, Desktop also
requires it to match the exact immutable resource loaded in the calling iframe.
Workspace tool denies apply. Read-only capability search runs directly;
capability execution uses conservative mutation annotations and requires user
confirmation, while the underlying provider/Program authorization and audit
path still runs server-side. Cross-server iframe calls are not allowed.
