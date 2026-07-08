# landing-connect-mcp — Add what your agents already do to OpenWork, share it, use it anywhere

The section leads with the user's existing agent life: the skills, MCPs, and
commands they already run in Claude Code or Cursor drop into OpenWork as-is
(same SKILL.md format, same remote MCP URLs), get shared org-wide, and come
back out through two MCP tools — `search_capabilities` and
`execute_capability` at `https://api.openworklabs.com/mcp/agent` — from any
agent. Layout: header, then two balanced cards (bring-it-in + agent's-eye
example window), then a full-width connect-your-agent install row.

1. Further down the OpenWork landing page, the pitch is personal: already doing it in your agent? The skills and MCPs you run in Claude Code or Cursor can be added to OpenWork and shared with your whole team.

2. The left card shows my existing setup moving in as-is — the Granola MCP, a meeting-brief skill, a review-pr command — same SKILL.md format, same server URLs, packaged and shared with the org in one link.

3. Next to it, an OpenWork window shows what a teammate's agent sees once connected: search_capabilities for meeting notes finds exactly what I shared — the Granola connection and the meeting-brief skill.

4. execute_capability runs that shared skill and the Acme Corp brief comes back — shared once, consumed from whatever agent a teammate already uses.

5. Below, connecting an agent is one click or one command — Add to Cursor up front; I flip to Claude Code, hit copy, and the exact command lands on my clipboard with three steps: sign in, pick your org, your team's tools appear.

6. Read the docs points at the Cloud MCP guide with the OAuth details — sign in in the browser, pick your org, and the token does the rest.
