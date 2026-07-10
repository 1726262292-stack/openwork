# Den corporate CA TLS

An OpenWork maintainer needs to distinguish a generic external-MCP `fetch failed`
from a corporate certificate that the Den Node process does not trust.

The integration proof generates an ephemeral corporate root and a localhost
server certificate, then runs the repository's complete OAuth MCP fixture over
HTTPS. The same Den `connect/start` route is evaluated in two fresh Node
processes:

1. Without the root, Node reports a certificate-chain error and Den returns the
   user-visible `502 oauth_handshake_failed` response containing `fetch failed`.
2. With the root supplied through `NODE_EXTRA_CA_CERTS` at process startup, Den
   completes protected-resource discovery and dynamic client registration, then
   returns `200 needs_auth` with the fixture's authorization URL.

The test must not use `NODE_TLS_REJECT_UNAUTHORIZED=0`. All generated keys and
certificates live in a temporary directory and are removed when the run ends.

Run this after the Daytona server helper has started MySQL and pushed the Den
schema:

```bash
pnpm evals --flow den-corporate-ca-tls
```

Expected outcome: the internal fraimz report contains the certificate error,
the untrusted `502`, the trusted `200 needs_auth`, and the final PASS marker.
