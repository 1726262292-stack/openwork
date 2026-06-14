# Security Architecture Review Tracker

Current PR scope: require fresh auth for organization invitation and member-removal actions.

## This PR

- Requires a session created in the last 15 minutes before owners/admins can invite members or remove members.
- Keeps the change small by reusing the existing `fresh_auth_required` helper instead of adding a new MFA or reauth system.
- Adds tests for fresh-auth coverage on invitation and member-removal authorization helpers.

## Remaining Follow-Ups

- Native MFA or a clear product decision that enforced SSO with IdP MFA is the supported production control.
- SCIM drift reconciliation and alerting beyond retryable mutation failures.
- Tamper-evident audit logging and SIEM export path.
- KMS-backed signing/encryption key storage and rotation plan.
- Explicit MCP dynamic-client PKCE and refresh-token rotation validation.

## Validation Log

- Passed: `pnpm exec bun test test` from `ee/apps/den-api` (145 tests, 0 failures)
- Passed: `pnpm test:e2e`
