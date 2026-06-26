# Third-party notices

## Flue (isometric agent chip SVG)

`components/landing-agent-chip.tsx` contains an SVG and its pixel-diamond
generators ported from Flue:

- Source: https://github.com/withastro/flue (`apps/www/src/pages/index.astro`)
- License: Apache License, Version 2.0 — https://www.apache.org/licenses/LICENSE-2.0

The file is a modified derivative work. Changes by OpenWork: ported from Astro
to React, relabeled the chip faces for OpenWork's stack, added a pixel shimmer
animation (`.chip-pixel` keyframes in `app/globals.css`), and namespaced the
drop-shadow filter id. The original copyright and license notice are retained in
the source file header per Apache-2.0 §4.
