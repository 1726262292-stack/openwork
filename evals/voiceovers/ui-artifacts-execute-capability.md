# UI artifacts — an execute-capability lifecycle

This demo follows deterministic mock data through the same two-tool cloud surface available to any compatible agent engine. It shows artifact discovery, rendering, explicit approval, state replacement, and stale-revision protection without contacting a live calendar, mail, chat, or approval provider.

1. UI Artifacts begins as an alpha preference in the right rail. The member can inspect eight standard chat-native patterns and decide which ones the agent is allowed to suggest and render.

2. Behind the scenes, the agent kept the OpenWork Cloud surface to search capabilities and execute capability, searched for one matching artifact, and used the returned schema. The result is this single workspace brief, turning the screenshot-style home dashboard into a focused answer inside chat.

3. An approval is rendered as mock data at revision one with both choices visible. Nothing has changed yet: the card is waiting for the member to make an explicit decision.

4. Clicking Approve still does not execute anything silently. It stages a visible, minimal request containing only the artifact instance, selected item, decision, and expected revision, while clearly forbidding a live provider action.

5. Once that exact request is executed, the same artifact instance is replaced by revision two and the selected item becomes approved. The mock MCP has also rejected a stale revision-one replay, proving that an old card cannot overwrite newer state.
