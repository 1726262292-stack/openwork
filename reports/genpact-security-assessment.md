# OpenWork Application Security Assessment

**Audience:** Genpact security review

**Assessment date:** 2026-08-28

**Status:** Draft — post-remediation CodeQL verification pending

## Executive summary

OpenWork uses GitHub CodeQL for static application security testing (SAST) and
GitHub Dependabot for software composition analysis (SCA). The remediation
branch addresses all 44 CodeQL findings in the assessed `dev` baseline: 33 high
and 11 medium severity findings. Focused regression tests and affected-package
type checks pass, subject to the limitations below.

This document intentionally excludes personal data, credentials, tokens, local
filesystem paths, and individual contact details.

## Assessment scope

- Repository: `different-ai/openwork`
- Baseline branch: `dev`
- Baseline CodeQL finding count: 44 open
- Baseline severities: 33 high, 11 medium
- Latest published release reviewed for identification: `v0.18.39`
- Release commit: `63625a4be566256370eebb84ad91b020a0f6cf06`
- SAST engine: GitHub CodeQL default setup
- SCA engine: GitHub Dependabot

## Remediation coverage

The changes address:

- unsafe or ambiguous HTML, XML, URL, and query-string handling;
- regular-expression denial-of-service patterns;
- raw internal error disclosure;
- unsafe dynamic code construction in browser test automation;
- credential-bearing URL persistence and authorization metadata exposure;
- insecure randomness warnings for generated identifiers;
- shell execution intent and image URL validation;
- findings in test fixtures and security evidence generators.

The detailed alert register is in
`reports/genpact-codeql-remediation.csv`.

## Verification completed

- Focused tests were run for each changed subsystem.
- Type checks passed for the affected application, server, Den API, inference,
  and enterprise MCP client packages.
- CDP structured-argument transport tests passed: 3/3.
- Server-focused assertions passed: 108/108; the Bun process subsequently
  terminated with a known local `SIGTRAP`, so that combined command is not
  represented as a clean passing suite.
- Database-backed integration tests were not run because the required local
  databases were unavailable.
- `git diff --check` passes.

## Verification still required

This assessment must not be presented as a final clean scan until:

1. the remediation branch is committed and pushed;
2. GitHub CodeQL completes against that exact commit;
3. any newly detected or persisting findings are resolved or formally
   risk-accepted;
4. the release candidate commit is scanned; and
5. the final CodeQL and Dependabot exports are attached.

Current verdict: **Incomplete — remediation implemented; authoritative CodeQL
rerun pending.**

## Scope limitations

- CodeQL provides SAST; Dependabot provides dependency/SCA coverage.
- This assessment does not include DAST, penetration testing, runtime cloud
  configuration review, or LLM prompt-injection testing.
- Test and mock-server findings were remediated rather than excluded solely
  because they were outside production runtime.

## Evidence to attach after the final scan

- GitHub CodeQL run URL and SARIF export for the exact release candidate commit
- Dependabot export showing the final open dependency-alert count
- This assessment and the remediation CSV
- Release tag and immutable commit identifier
