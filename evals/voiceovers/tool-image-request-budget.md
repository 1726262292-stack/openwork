# tool-image-request-budget — Request-only image budget keeps tool images usable

1. The demo starts with the regression shape: a normal user image plus a tool result that returns multiple inline images. With the eval budget lowered, the unprotected provider request is too large and the fake provider reports the same malformed-body class of failure users saw.

2. The real OpenWork runtime config includes the media-budget plugin path, and the package build includes the built plugin. When the hook runs on the request copy, the newest image stays available, older images become clear text notes, and the next provider body is valid JSON under the encoded inline-image budget.

3. The same transformed history is replayed through the hook again. Nothing changes on the second pass, proving the request cleanup is deterministic and safe for session history replay.
