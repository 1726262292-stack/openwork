# Native MCP Apps

OpenWork supports MCP Apps delivered by standard MCP servers connected through
OpenWork Connect. A server advertises the stable
`io.modelcontextprotocol/ui` extension, a tool binds an exact UI resource with
`_meta.ui.resourceUri`, the host reads that resource with `resources/read`, and
tool inputs and results move over the standard MCP Apps bridge.

This unit of value does **not** include installing a standalone App from an
HTML URL. URL-imported MCP Apps are deferred future work with a separate
product, security, lifecycle, and rollout contract.

Programs remain executable `script` config objects. A Program's generated
views can be MCP resources, but that does not turn Program execution into
resource loading or a standalone URL-App installation path.

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

For a capable model client, the proxy returns no provider tools or resources
and rejects direct provider calls. The model discovers and invokes ordinary
provider operations only through the central `search_capabilities` and
`execute_capability` tools.

Desktop's local App host marks its transport as the app-host audience. Only
that transport receives tools with a valid `_meta.ui.resourceUri`, forced to
`app` visibility, plus app-visible `search_capabilities` and
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
the proxy boundary. The app-host transport never receives credentials or
direct cross-server access.

## Rollout isolation

Native MCP Apps fail closed behind two existing gates:

1. the deployment gate `DEN_REMOTE_MCP_APPS_ENABLED=true`; and
2. the organization capability **Native MCP Apps (preview)**.

Both default off. No additional user-facing flag controls standalone URL Apps.
When either native-App gate is off, ordinary connected MCP tools remain
available through `search_capabilities` and `execute_capability`, but OpenWork
removes MCP App classification and launch metadata, publishes no provider App
endpoint in the member index, and renders no App UI.

For deployment-order compatibility, a previously released Desktop client that
lacks the capability marker retains the provider endpoint behavior it already
had until it upgrades. This compatibility path remains behind both default-off
gates. Capable clients never receive the provider catalog in their
model-facing transport.

The provider proxy advertises `listChanged: false` because the current
enterprise connector opens bounded request sessions rather than a durable
downstream notification stream. Catalog refresh happens on Connect
reconciliation, Desktop startup, engine refresh, or an explicit Cloud MCP
refresh. Forwarding downstream list-change notifications remains follow-up
interoperability work.

## Deferred: standalone URL-imported Apps

Installing a self-contained HTML App from a URL is intentionally outside this
change. In the current product:

- Den Web has no Add MCP App button, URL form, installed-App detail page, or
  URL-App lifecycle entry point;
- the central MCP server does not register `import_remote_mcp_app` or any
  standalone-App launch tool;
- capability search returns no standalone URL-App matches;
- model and App-host catalogs contain no standalone URL-App tools;
- no `ui://openwork/library-apps/...` resources are registered;
- member server indexes and launch metadata contain no standalone URL Apps;
- REST calls under `/v1/remote-mcp-apps` are not registered and are therefore
  unavailable.

Existing database rows and cached revisions from earlier development remain
stored non-destructively. They are inactive and unreachable through the UI,
MCP catalogs, capability search, resources, launch metadata, and HTTP API. This
change performs no deletion and introduces no destructive migration.

The retained storage and validation implementation is not a supported runtime
surface. A future standalone URL-App unit of value must deliberately restore
its own API, UI, security review, lifecycle, testing, and rollout contract.

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
