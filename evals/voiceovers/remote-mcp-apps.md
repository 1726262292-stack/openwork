# remote-mcp-apps — Import, connect, and launch a portable MCP App

Cast is Alex, an OpenWork user who has published Project Atlas, a self-contained Vite app, as
one HTML file. The file carries an OpenWork MCP App manifest describing the
single read-only Connect capability it needs. This demo proves that the URL is
only an import source: OpenWork owns an immutable cached revision, exposes the
app through the Library and agent MCP, and never gives the app credentials.

1. Alex opens Library, chooses Add remote MCP App, and pastes the published app URL. OpenWork downloads the file and shows its name, version, source, SHA-256 digest, and requested read-only capability before activation.

2. Alex binds the app's project-search requirement to an MCP connection already authorized through OpenWork Connect. The review makes clear that the app receives only this exact tool and never receives the connection credentials.

3. Alex imports and activates the revision. The app appears in Library as Ready, with its exact immutable revision and a Download cached app action.

4. In a new conversation, the agent discovers Project Atlas and launches it as a sandboxed MCP App. Its launch result supplies only render-time metadata; the app calls its namespaced proxy tool to display project data from the bound Connect capability.

5. Alex publishes an update and refreshes the source URL. OpenWork caches a second immutable revision as a draft while the active revision remains unchanged until Alex explicitly activates it. Alex can roll back to the older revision just as explicitly.

6. The original source is taken offline. Project Atlas still launches from OpenWork's cached `ui://` resource, and Alex can download the exact cached HTML, proving that the installed app has no runtime dependency on the source host.
