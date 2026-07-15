# chat-connection-reconnect-card — when a connector breaks mid-chat, the chat itself gets you reconnected

Cloud MCP tool results already carry a structured `connection_status` payload
when a connector needs re-authentication (expired OAuth grant, rejected token
refresh, provider-side outage). Today that payload renders as raw JSON inside
the tool part, and the user has no idea what to do next. This flow turns it
into an actionable card in the conversation, reusing the existing Connect
machinery (`needsReconnect`, member-scoped non-destructive disconnect, the
amber Reconnect row) — no new stores, no new API surface.

1. I ask my agent to pull my latest meeting notes, not knowing the connector's login quietly expired behind the scenes.

2. Instead of a wall of JSON, the chat shows me a card that says it plainly: Granola needs me to sign in again — with a Reconnect button right there in the conversation.

3. I click Reconnect and land on the Connections page with the broken connector highlighted, one click away from signing back in.

4. When the problem isn't mine to fix, the card says so honestly — it names who has to act and hands me the diagnostic reference to copy for support.

5. And for anyone who wants the raw details, the full technical payload is still one click away under a disclosure — nothing is hidden, it's just no longer the default.
