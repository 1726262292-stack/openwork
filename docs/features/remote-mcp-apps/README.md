# MCP Apps

OpenWork delivers MCP Apps over the stable `io.modelcontextprotocol/ui`
extension: a tool binds an exact UI resource with `_meta.ui.resourceUri`, the
host reads that resource with `resources/read`, and tool inputs and results
move over the standard MCP Apps bridge. Two distinct units of value share that
protocol surface and nothing else:

1. **Native MCP Apps** — apps advertised by regular MCP servers connected
   through OpenWork Connect. This document describes them.
2. **Plugin-installed URL MCP Apps** — self-contained HTML apps installed by
   URL into an OpenWork Connect Plugin and hosted by the central
   `openwork-cloud` server. They have their own product, security, lifecycle,
   and rollout contract, documented in
   [plugin-installed-apps.md](plugin-installed-apps.md), and their own
   default-off gates (`DEN_PLUGIN_MCP_APPS_ENABLED` + the `pluginMcpApps`
   organization capability) that never overlap with the native gates below.

Programs remain executable `script` config objects. A Program's generated
views can be MCP resources, but that does not turn Program execution into
resource loading or a URL-App installation path.

## Standard MCP server path

Connect continues to own server configuration, authentication, access grants,
per-member credentials, and tool policy. The OpenWork Cloud control server
publishes a member-scoped resource at:

```text
openwork://connect/mcp-servers/index.json
```

The signed-in Desktop session mints a separate short-lived App-host credential
with a non-public `mcp:app-host` scope. Desktop stores that credential and the
endpoint descriptors only in private App-host state; neither is projected into
OpenCode. It reads the index with that credential and advertises the
`mcp-app-host-v1` client capability. Den returns a non-empty provider index only
when the server-verified scope, client capability, and both rollout gates are
present. A normal model or legacy MCP token cannot unlock the index by spoofing
an audience or capability header. Desktop never writes `openwork-connect-*`
entries to the OpenCode runtime or any model-visible MCP registry. A connection
is proxied at:

```text
/mcp/agent/connections/{connectionId}
```

For capable model clients and legacy clients alike, the proxy returns no
provider tools, resources, or templates and rejects direct provider calls.
The model discovers and invokes ordinary provider operations only through the
central `openwork-cloud` `search_capabilities` and `execute_capability` tools.

Desktop's local App host authenticates with the private scoped credential. Only
that transport receives tools with a valid `_meta.ui.resourceUri` whose
provider-declared visibility includes `app`, plus app-visible `search_capabilities` and
`execute_capability` scoped to the originating server. A native MCP App can
therefore render and use authorized tools from its regular MCP server without
placing the provider catalog in the model request.

The app-host view preserves:

- the App tool's exact name, input/output schemas, annotations, and UI binding;
- concrete descriptors and `resources/read` content only for resources bound
  by exposed App tools;
- `content`, `structuredContent`, `_meta`, and `isError` from `tools/call`;
- the stable MCP Apps extension and `text/html;profile=mcp-app` resources;
- one server identity per Connect connection, preserving the same-server
  tool-call boundary.

OpenWork access grants, disabled-tool policy, and approval rules still apply at
the proxy boundary. The App-host credential authorizes only this bounded proxy
surface; it is not a provider credential and grants no direct cross-server
access.

## Rollout isolation

Native MCP Apps fail closed behind two existing gates:

1. the deployment gate `DEN_REMOTE_MCP_APPS_ENABLED=true`; and
2. the organization capability **Native MCP Apps (preview)**.

Both default off. No additional user-facing flag controls standalone URL Apps.
When either native-App gate is off, ordinary connected MCP tools remain
available through `search_capabilities` and `execute_capability`, but OpenWork
removes MCP App classification and launch metadata, publishes no provider App
endpoint in the member index, clears the private App-host catalog, and renders
no App UI. Reconciliation also removes and disconnects stale
`openwork-connect-*` OpenCode entries while preserving user-authored MCPs and
all durable Connect records.

The provider proxy advertises `listChanged: false` because the current
enterprise connector opens bounded request sessions rather than a durable
downstream notification stream. Catalog refresh happens on Connect
reconciliation, Desktop startup, engine refresh, or an explicit Cloud MCP
refresh. Forwarding downstream list-change notifications remains follow-up
interoperability work.

## Plugin-installed URL Apps are a separate unit

Installing a self-contained HTML App from a URL is not part of the native
unit. It ships separately as **plugin-installed URL MCP Apps** — see
[plugin-installed-apps.md](plugin-installed-apps.md) for the product model,
authorization, lifecycle, standards surface, and rollout contract. With that
unit's own gates off, its entire surface is absent (no installation UI or
mutation API, no capability matches, no launch tools, no
`ui://openwork/library-apps/...` resources) while stored records and cached
revisions remain retained non-destructively. There is never a global
"standalone Apps" library and there is no `import_remote_mcp_app` model tool.

## Host security and compatibility

Desktop negotiates the stable extension, resolves the current tool definition,
reads the exact `ui://` resource even when it is absent from `resources/list`,
accepts text or base64 HTML, enforces MIME and size limits, validates CSP
origins, and loads the document through the isolated sandbox proxy. It sends
tool input and the preserved tool result after initialization, bounds size
changes, tears the bridge down on unmount, and contains resolution, handshake,
document, and runtime failures without hiding the normal tool result.

App-requested tools are resolved only on the originating regular MCP server
and must be visible to the app. When a tool carries `_meta.ui.resourceUri`,
Desktop also requires it to match the exact resource loaded in the calling
iframe. Workspace denies apply. Read-only capability search runs directly;
capability execution uses conservative mutation annotations and requires user
confirmation while provider authorization and audit still run server-side.
Cross-server iframe calls are not allowed.
