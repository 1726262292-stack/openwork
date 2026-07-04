# search-routed-capabilities — Connections and plugins are found and run, not pasted into the harness

Today every connection you add is injected into the engine's config (spawn-time
file plus fragile hot-add), and every plugin skill is a file install — the
harness carries everything up front whether or not a session needs it.
OpenWork Cloud already solved this with exactly two tools
(`search_capabilities` + `execute_capability`) on `/mcp/agent`. This demo
lands the same pattern locally: a connection routed on-demand, discovered by
search, dialed just-in-time; a plugin's skill answered through the same two
verbs; and, when signed in, cloud capabilities merging into the very same
search surface.

1. This is OpenWork. I'm adding my team's glossary connection — but instead of loading its tools into every session, I flip one switch: route it on demand.

2. The connection is saved, and here's the difference — the agent's engine config never picks it up. Nothing was pasted into the harness; sessions stay lean.

3. I start a chat and ask a plain question — what does "blue-forty" mean in our glossary. I don't name a tool, and I don't mention the connection.

4. The agent searches its capabilities, and the glossary tool comes back as a match — found by search, not carried in context.

5. It executes the match. OpenWork dials the connection just-in-time, runs the real tool, and the definition comes back in the answer.

6. The same two verbs cover plugins too — I ask about our release runbook, and the skill that shipped as a plugin is found and read through the exact same search-and-execute path.

7. And because I'm signed into OpenWork Cloud, that same search reaches my organization's cloud capabilities too — local connections, plugin skills, and cloud, one search surface, still just two tools.

8. That's the whole change: connections and plugins stop being config you paste into the harness, and become capabilities the agent finds the moment it needs them.
