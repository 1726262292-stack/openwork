# chat-connection-reconnect-card — when a connector breaks mid-chat, the chat itself gets you reconnected

Cloud MCP tool results already carry a structured `connection_status` payload
when a connector needs re-authentication (expired OAuth grant, rejected token
refresh, provider-side outage). Today that payload renders as raw JSON inside
the tool part, and the user has no idea what to do next. This flow turns it
into an actionable card in the conversation, reusing the existing Connect
machinery (`needsReconnect`, member-scoped non-destructive disconnect, the
amber Reconnect row) — no new stores, no new API surface.

1. I ask the agent for my latest Granola notes.

2. A polished, compact connection card appears with a clear Granola identity, a calm status treatment, a concise explanation, and one obvious action: Reconnect.

3. Reconnect takes me directly to the highlighted Granola connection.

4. If Granola rejects authentication and the provider may be responsible, the card still lets me try reconnecting. It explains that if reconnecting fails again, Granola or my admin may need to fix the provider configuration.

5. Technical details and the diagnostic reference remain available under a secondary disclosure without dominating the card.
