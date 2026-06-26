# Third-party notices

## Flue (Copy Prompt button)

`components/copy-prompt-button.tsx` and the `.squircle-button` rule in
`app/globals.css` are ported from Flue:

- Source: https://github.com/withastro/flue
  (`apps/www/src/pages/index.astro`, `apps/www/src/styles/global.css`)
- License: Apache License, Version 2.0 — https://www.apache.org/licenses/LICENSE-2.0

These are modified derivative works. Changes by OpenWork: ported the Astro
markup + inline script to a React component with state-driven feedback,
relabeled the prompt text and the copied-feedback copy for OpenWork, and applied
OpenWork's ink palette. The four animated glyph SVGs, the hover-preview tooltip,
the `data-feedback` / `data-copy-error` feedback states, and the squircle button
shape are reused from Flue. The original copyright and license are retained in
the source file header per Apache-2.0 §4.
