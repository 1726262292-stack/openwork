# mcp-search-input-schema — Search teaches the call shape, execute refuses guesses

Cast: an OpenWork Cloud organization with a synthetic incident MCP connected as
a real external connection. Before this change, capability search reduced every
external tool to a name and a description, so agents had to guess arguments —
and providers received empty payloads.

1. Searching capabilities now returns more than a name: the incident tool's match carries a bounded input summary — its required fields, argument types, and descriptions — plus a schema fingerprint that changes whenever the provider changes the tool.

2. Even a tool with an enormous schema stays bounded: the summary caps the properties it lists and marks itself truncated instead of flooding the agent's context window.

3. Executing the tool with no arguments no longer sends an empty payload to the provider: OpenWork refuses with missing required arguments, names the fields, and hands back the input summary — and the provider never sees the call.

4. With the required field supplied, the very same tool executes for real and returns the provider's genuine result.
