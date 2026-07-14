# mcp-connection-states-origin — Connections tell the truth, tools name their source

Cast: a user managing custom MCP apps on the OpenWork desktop. In an
enterprise debugging session, a working connection read as "not connected",
and with two similar connectors enabled nobody could tell which one a chat
tool call had used. Connection rows now show distinct states, and every tool
invocation in chat names its connection.

1. The connections list tells the truth at a glance: a healthy public app reads Ready — a live protocol session, not a vague not-connected.

2. Turning the app off is its own state: the row reads Paused instead of collapsing into a binary.

3. A connector pointing at a dead address reads Issue — a failure is distinct from off, and distinct from never-started.

4. In chat, every tool call now names its connection: the invocation row carries a badge with the app that executed it, so two similar connectors can never be confused again.
