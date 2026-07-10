# den-corporate-ca-tls — Den outbound OAuth uses an explicitly mounted corporate CA

Cast is an OpenWork maintainer reproducing a customer's OAuth MCP failure inside the Daytona Den server environment.

1. The proof sends the same connection through the real Den route twice: first Node rejects the private certificate and Den returns the observed fetch failure; then a fresh process starts with the corporate root and reaches the OAuth authorization handoff without weakening TLS verification.
