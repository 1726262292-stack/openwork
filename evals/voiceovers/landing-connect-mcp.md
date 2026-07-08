# landing-connect-mcp — Connect any agent to OpenWork Cloud from the landing page

OpenWork Connect exposes an org's whole toolbox — cloud capabilities, org MCP
connections, and marketplace plugins — through two MCP tools,
`search_capabilities` and `execute_capability`, served at
`https://api.openworklabs.com/mcp/agent` (remote streamable HTTP, browser
OAuth). This section turns that into a one-click / one-command install on
openworklabs.com, in the style of the best "Add to Cursor" server pages.

1. Scrolling the OpenWork landing page, I reach a new section — Connect any agent — my whole OpenWork org, capabilities, connections, and marketplace, is two MCP tools away, and the server URL is right there.

2. I pick my client: Cursor is selected with a one-click Add to Cursor button, and tabs for Claude Code, OpenCode, VS Code, and everything else sit beside it.

3. I switch to Claude Code and it's a single command; I hit copy and the exact command lands on my clipboard — the button flips to Copied.

4. Beside the install card, the section shows what connecting unlocks: the agent calls search_capabilities for meeting notes and ranked matches come back, including the org's Granola connection, each with the parameters it takes.

5. Then execute_capability runs the top match and the data comes back — search, then execute: everything OpenWork Connect can do, from whatever agent I already use.

6. Read the docs points at the Cloud MCP guide with the OAuth details — sign in in the browser, pick your org, and the token does the rest.
