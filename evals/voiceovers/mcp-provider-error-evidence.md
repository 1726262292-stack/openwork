# mcp-provider-error-evidence — Provider failures stop being opaque

Cast: an OpenWork Cloud organization with a synthetic ServiceNow-style MCP
connected as a real external connection. Its incident tools fail exactly the
way real enterprise providers fail — HTTP 200, with the error buried inside an
error-marked tool result. Before this change, every such failure collapsed
into a generic provider error and the provider's own words were discarded.

1. A synthetic ServiceNow-style MCP is connected to OpenWork Cloud as a real external connection, and its incident tool fails the way enterprise providers really fail — a successful HTTP response carrying an error-marked tool result.

2. Executing the incident lookup now yields a support-ready diagnostic: OpenWork classifies the provider's own 403, and the diagnostic carries provider status 403, the provider's error code, its transaction id, the payload size, and a reference id — while the provider's raw payload stays out of the model-visible response.

3. A backend failure with no parseable status, like a Redis cluster error, still classifies as a provider tool error — and the diagnostic now proves the provider answered, recording the payload byte size and a reference for support without leaking the raw error text.
