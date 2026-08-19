# Den core

Den API imports these shared modules through package subpaths so a follow-up app split can reuse the same domain layer.

The standalone MCP host can load its API tool catalog from `src/generated/mcp-catalog-openapi.json`. This is the normalized Den API OpenAPI document pruned to catalog-eligible operations; included operations remain complete, and component parameters are retained for reference resolution.

Regenerate both the docs and catalog snapshots with `pnpm --filter @openwork-ee/den-api openapi:snapshot`. Check committed snapshots for drift with:

```sh
pnpm --filter @openwork-ee/den-api openapi:snapshot:check
```
