# mcp-url-normalization — A stray period can no longer poison a connection

Cast: a user adding a custom MCP app on the OpenWork desktop, and an
organization admin creating a cloud connection. In the field, a PostHog
connection failed OAuth with "invalid argument" because its URL carried an
invisible trailing period in the hostname — a legal URL that breaks issuer and
resource comparisons downstream. Both entry points now save the cleaned URL.

1. The exact failure from the field: adding a custom app whose URL hides a trailing period in its hostname. The desktop saves the cleaned address — the app's own row shows the URL without the dot, and the connection still comes up against the live public server.

2. The organization side gets the same protection: creating a cloud connection with the dotted URL stores the normalized address and still connects, so OAuth discovery and issuer checks can never be poisoned by a stray period again.
