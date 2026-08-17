# Plugin-installed URL MCP Apps

A member with plugin-editing rights can install an MCP App by supplying an
HTTP(S) URL, exactly the way a skill is added to a plugin. OpenWork downloads
and validates the self-contained HTML once, stores it as an immutable
config-object revision, and serves it as a **standard MCP App** from the single
central `openwork-cloud` server. Any standards-compliant MCP Apps harness that
connects that one server can discover, launch, and render the App; the
rendered App performs every meaningful operation through the central
`search_capabilities` and `execute_capability` gateway tools.

This unit is deliberately separate from **native MCP Apps** (apps advertised
by regular MCP servers connected through OpenWork Connect, documented in
[README.md](README.md)). The two share the `io.modelcontextprotocol/ui`
protocol surface and nothing else: different ownership, different lifecycle,
different rollout gates.

## What is what

| Surface | Owner | Delivery | Gate |
| --- | --- | --- | --- |
| Native MCP Apps | The connected MCP server | Per-connection proxy endpoint + private App-host catalog | `DEN_REMOTE_MCP_APPS_ENABLED` + org `remoteMcpApps` |
| Plugin-installed URL Apps | An OpenWork Connect Plugin | The central `openwork-cloud` server itself | `DEN_PLUGIN_MCP_APPS_ENABLED` + org `pluginMcpApps` |
| Ordinary Connect capabilities | Connectors, plugins, Programs | `search_capabilities` / `execute_capability` | existing Connect gates |

## Product model: the plugin owns the App

Every installed App belongs to exactly one existing plugin. The App's bytes
live in immutable `ConfigObjectVersion` rows under an `objectType: "app"`
config object attached to the plugin — the same plugin/config-object
architecture as skills. A small `remote_mcp_app` row keeps the mutable
installation state: the source URL, the explicitly selected active revision,
and the active/retired status. One plugin can contain skills, Programs, and
one or more installed Apps.

Availability follows plugin availability and the member's authorization:
discovery, resource reads, launch, and every App-initiated call require the
same explicit member, team, or org-wide plugin/marketplace grants as every
other marketplace capability. A member who cannot use the plugin cannot
discover, read, launch, or call its Apps — administrators included, because
capability discovery follows explicit grants, not admin visibility. Archiving
the plugin, retiring the App, or turning the rollout off makes the App
inactive everywhere without deleting any record or revision.

## Installation and lifecycle

Installation lives in plugin management in Den Web (plugin detail → MCP Apps →
Add MCP App), next to skills. There is no global "Add MCP App" button and no
agent-facing installer tool. The flow is preview → confirm:

1. **Preview** downloads through the hosted SSRF guard and validates without
   storing: HTTPS only (loopback HTTP only in explicit development mode), no
   embedded credentials or credential-looking query parameters, redirects
   validated hop-by-hop, `text/html`/`application/xhtml+xml` with UTF-8 only,
   768 KiB ceiling, 15 s timeout, and a strict self-containment check that
   rejects external scripts, stylesheets, images, media, frames, CSS
   URLs/imports, `<base>`, and embedded CSP.
2. **Install** re-validates, stores the exact bytes and SHA-256 digest as an
   immutable revision, activates it, and derives display metadata from the
   document `<title>` and description meta tag. Installing the same URL with
   unchanged content into the same plugin is idempotent.
3. **Refresh** caches a new immutable draft revision without changing the
   active one (unchanged bytes add nothing; retained revisions are capped at
   20). **Activate** switches or rolls back the served revision after an
   integrity check. **Retire** removes the App from discovery and launch while
   keeping every revision; **restore** re-exposes it. Nothing in the lifecycle
   deletes data, and the source URL is never needed at launch time.

The REST surface under `/v1/remote-mcp-apps` (preview, install, detail,
refresh, activate, lifecycle, revision download) enforces the rollout gate per
organization and PluginArch roles per plugin (editor to install/refresh,
manager to retire). These installation operations are deliberately excluded
from the generic capability gateway, so neither a model nor a sandboxed App
can reach them through `execute_capability`.

## Standards-first delivery on `openwork-cloud`

For each App the member can use, the central server registers exactly two
things through the stable `io.modelcontextprotocol/ui` extension:

- an **inert, app-visible launch tool** (`open_plugin_app_<hash>`) whose
  `_meta.ui` carries the exact active `ui://` revision and
  `visibility: ["app"]`; calling it returns only bounded launch context (App
  identity, revision, digest, the gateway tool names, an input echo);
- the **active immutable resource** at
  `ui://openwork/library-apps/{configObjectId}/revisions/{versionId}/index.html`,
  served by ordinary `resources/read` as `text/html;profile=mcp-app`, with a
  digest check on every read.

An independent MCP Apps reference host therefore needs nothing but the one
`openwork-cloud` connection: initialize negotiating the ui extension, find the
launcher in `tools/list` by its UI binding, read the bound resource, render,
and bridge the App's tool calls back to the same server. No OpenWork Desktop,
no Desktop-local catalog, no per-provider endpoint, no `openwork/mcpApp`
metadata, and no proprietary headers are required.

**Model-facing discovery** goes through `search_capabilities`: an authorized
App appears as a marketplace match named `plugin:{pluginId}:{configObjectId}`
with `kind: "mcp_app"`, its plugin and description, a launch hint, and the
active `ui://` URI — never source URLs or storage internals. Executing the
match through `execute_capability` validates the exact app, plugin, active
revision, and authorization at launch time and returns a bounded launch
payload; a stale, retired, unauthorized, or mismatched launch fails closed as
`unknown_capability`. For compatible OpenWork hosts the result also carries
`_meta["openwork/mcpApp"]` (launcher name + resource URI) — a **Desktop
adapter hint**, mirroring native MCP Apps, that standards hosts are free to
ignore because the launcher tool is the protocol contract.

**The App's operational surface** is exactly `search_capabilities` and
`execute_capability` (both marked visible to model and app audiences). All
other model tools — including the Code Mode runtime `execute_capability_script`
and the Program catalog tools — are marked `visibility: ["model"]`, and the
App host enforces that: a sandboxed App cannot run confined orchestration
code, select Programs, call provider tools, or reach another server. Provider
authorization, member access, tool policy, approval requirements for
non-read-only calls, result-size limits, audit behavior, and capability schema
validation all continue to apply because App calls are ordinary gateway calls.

Programs (Code Mode scripts) compose cleanly: an App rediscovers an authorized
Program through `search_capabilities` (matches carry `argumentsSchema` and a
`schemaDigest` of the input contract) and executes it through
`execute_capability`. A stale `schemaDigest` is rejected with a
search-again retry, and a retired or unauthorized Program is absent from
search and rejected on execution. With the Code Mode gate off, Programs
disappear while installed Apps and ordinary capabilities keep working.

## OpenWork Desktop as an adapter

Desktop consumes the same standard surface. Its chat flow executes the
capability match, reads the `openwork/mcpApp` adapter hint, re-resolves the
launcher **live** on the same `openwork-cloud` server (app visibility and the
exact advertised resource URI must match), reads the resource, and renders it
in the existing isolated MCP App sandbox. App-initiated calls go through the
host bridge, which permits only app-visible tools on the originating server,
requires user approval for non-read-only calls, and enforces the workspace
deny list. Desktop never writes an `openwork-connect-*`, per-App, or
per-provider MCP entry into the OpenCode runtime — the only MCP entry involved
is `openwork-cloud` itself.

## Rollout

The unit fails closed behind two dedicated gates, both default off:

1. deployment: `DEN_PLUGIN_MCP_APPS_ENABLED=true`;
2. organization capability: `pluginMcpApps` (platform admin, per org).

These are intentionally not the native-App gates: an operator can roll out
native MCP Apps and plugin-installed Apps independently. While the
installed-App gate is off — for the deployment or for one organization — the
entire surface is absent: no installation UI or mutation API (direct REST
calls return 404 `plugin_mcp_apps_disabled`), no capability matches, no
launch tools or launch metadata, no `ui://` resources, and protocol-valid
empty answers everywhere else. Stored records and revisions remain retained
and reappear unchanged when the gate is re-enabled. Native Apps and ordinary
central search/execute are unaffected in both directions.

Legacy rows from the pre-rollout implementation stay stored and inactive:
without a live plugin membership and explicit grants they are unreachable
through search, execution, resources, REST, and UI, and nothing migrates or
deletes them. A plugin editor can deliberately re-install the App through the
new workflow.

## Security summary

- Hosted SSRF guard on every fetch and redirect; HTTPS required outside
  explicit loopback development; credentialed URLs and sensitive query
  parameters rejected; bytes, time, MIME, and encoding bounded.
- App HTML and metadata are untrusted: self-containment is enforced at
  install, the stored digest is re-verified on every read and launch, and the
  document renders only inside the existing MCP App sandbox with a closed
  network/resource CSP and no device permissions, top-level navigation, or
  cross-server calls.
- OpenWork never forwards tokens, cookies, or provider credentials to the
  source URL, and the App never receives credentials — provider calls execute
  server-side through the authorized gateway.
- Member authorization applies at installation, discovery, resource reads,
  launch, and every App-initiated operation; failure is always closed.

## Known harness compatibility limitations

- **Harnesses that ignore standard visibility metadata** (today's OpenCode
  included) will list the app-visible launcher tools in the model catalog.
  The launchers are inert and read-only — calling one returns launch context,
  never provider data — and each visible App adds exactly one bounded tool
  (capped at 50 per member). Hosts that honor `_meta.ui.visibility` show the
  model none of them.
- The central server advertises `listChanged` and emits standard list-change
  notifications, but harnesses that cache `tools/list` across sessions will
  see newly installed or retired Apps only on their next catalog refresh.
- Rendering from a chat *result* (rather than by calling the launcher
  directly) requires host support for re-resolving a launch reference; hosts
  without that adapter can still render by calling the advertised launcher —
  the standards path proven by the reference-host tape.
