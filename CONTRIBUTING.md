# Contributing to OpenWork

Thanks for contributing. Two things keep this project's licensing clean —
please read them before opening a pull request.

## 1. Developer Certificate of Origin (DCO)

Every commit must be signed off, certifying the
[Developer Certificate of Origin v1.1](https://developercertificate.org/):

```
git commit -s -m "your message"
```

This adds a `Signed-off-by: Your Name <your@email>` trailer asserting that
you wrote the change (or otherwise have the right to submit it) and that you
may submit it under this repository's licenses. Pull requests with unsigned
commits cannot be merged.

## 2. How your contribution is licensed

This repository is open core:

- Contributions to code **outside `ee/`** are accepted under the
  [MIT license](./LICENSE) (inbound = outbound).
- Contributions to code **under `ee/`** are accepted under the
  [OpenWork EE License](./ee/LICENSE). Per that license, Different AI, Inc.
  retains all right, title, and interest in and to modifications and patches
  to the EE-licensed software, and every EE release converts to MIT one year
  after publication.

By submitting a pull request you agree your contribution is provided under
the license governing the directory it modifies.

If you are contributing as part of paid work, a work trial, or on behalf of
an employer, make sure a signed agreement covering intellectual property
assignment is in place with Different AI, Inc. **before** your first pull
request — ask your contact at OpenWork if you are unsure. Maintainers will
not merge substantive contributions from paid engagements without one.

## Practical notes

- Use pnpm, never npm or yarn.
- Keep diffs as small as possible; propose the simpler solution.
- Runtime-observable changes need test evidence on the PR (see `AGENTS.md`).
- Never commit secrets, credentials, or personal data.
