/**
 * Isometric "agent chip" hero visual.
 *
 * The SVG geometry and the chipCells/piCells pixel-diamond generators are ported
 * verbatim from Flue (https://github.com/withastro/flue,
 * apps/www/src/pages/index.astro), which is licensed under the Apache License,
 * Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0).
 *
 * MODIFIED by OpenWork from the original Flue source:
 *  - converted Astro/JSX attributes to React (camelCase, style objects)
 *  - relabeled the chip faces for OpenWork's stack (AGENT / WORKER, etc.)
 *  - added a staggered shimmer animation for the blue pixel diamonds
 *    (the upstream ships none; see `.chip-pixel` keyframes in app/globals.css)
 *  - namespaced the drop-shadow filter id to avoid collisions
 */

const chipCells = Array.from({ length: 16 * 16 }, (_, index) => {
  const row = Math.floor(index / 16);
  const col = index % 16;
  return {
    x: 500 + (col - row) * 21,
    y: 84 + (col + row) * 12,
    delay: ((row * 7 + col * 11) % 17) * 0.17,
  };
});

const piPixelPattern = ["1110", "1010", "1101", "1001"];

const piCells = piPixelPattern.flatMap((line, sourceRow) =>
  [...line].flatMap((value, sourceCol) =>
    value === "1"
      ? Array.from({ length: 9 }, (_, index) => {
          const row = sourceRow * 3 + Math.floor(index / 3) + 2;
          const col = sourceCol * 3 + (index % 3) + 2;
          return {
            x: 500 + (col - row) * 21,
            y: 84 + (col + row) * 12,
          };
        })
      : [],
  ),
);

export function LandingAgentChip({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="75 20 850 650"
      role="img"
      aria-labelledby="agent-chip-title agent-chip-desc"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id="agent-chip-title">OpenWork agent architecture</title>
      <desc id="agent-chip-desc">
        An isometric agent stacked above the OpenWork worker runtime.
      </desc>

      <defs>
        <filter id="openwork-chip-shadow" x="-20%" y="-30%" width="140%" height="170%">
          <feDropShadow dx="0" dy="7" stdDeviation="8" floodColor="#111827" floodOpacity="0.09" />
        </filter>
      </defs>

      <path d="M500 54L866 264V384L500 594L134 384V264Z" fill="#fff" filter="url(#openwork-chip-shadow)" />

      <path
        d="M134 319L500 529L866 319V384L500 594L134 384Z"
        fill="#f8fafc"
        stroke="#cbd5e1"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M134 319L500 529V594L134 384Z"
        fill="#f1f5f9"
        stroke="#cbd5e1"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M500 529L866 319V384L500 594Z"
        fill="#e9eef5"
        stroke="#cbd5e1"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <text
        x="154"
        y="274.5"
        fill="#a8b2c1"
        fontFamily="JetBrains Mono, monospace"
        fontSize="19"
        fontWeight="600"
        letterSpacing="1.25"
        dominantBaseline="middle"
        transform="skewY(30)"
      >
        WORKER
      </text>
      <text
        x="516"
        y="851.5"
        fill="#a8b2c1"
        fontFamily="JetBrains Mono, monospace"
        fontSize="14"
        fontWeight="600"
        letterSpacing="0.7"
        textAnchor="start"
        dominantBaseline="middle"
        transform="skewY(-30)"
      >
        DESKTOP · CLOUD · SANDBOX
      </text>

      <path
        d="M500 54L866 264L500 474L134 264Z"
        fill="#fff"
        stroke="#d1d5db"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M134 264L500 474V529L134 319Z"
        fill="#f9fafb"
        stroke="#d1d5db"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M500 474L866 264V319L500 529Z"
        fill="#f3f4f6"
        stroke="#d1d5db"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <text
        x="154"
        y="217"
        fill="#b0b6c0"
        fontFamily="JetBrains Mono, monospace"
        fontSize="19"
        fontWeight="600"
        letterSpacing="1.25"
        dominantBaseline="middle"
        transform="skewY(30)"
      >
        AGENT
      </text>
      <text
        x="516"
        y="792"
        fill="#b0b6c0"
        fontFamily="JetBrains Mono, monospace"
        fontSize="14"
        fontWeight="600"
        letterSpacing="0.7"
        textAnchor="start"
        dominantBaseline="middle"
        transform="skewY(-30)"
      >
        SKILLS · MCP · PLUGINS
      </text>

      <g className="chip-pixels">
        {chipCells.map((cell, index) => (
          <path
            key={index}
            className="chip-pixel"
            d={`M${cell.x} ${cell.y - 10}L${cell.x + 18} ${cell.y}L${cell.x} ${cell.y + 10}L${cell.x - 18} ${cell.y}Z`}
            fill="#3b82f6"
            style={{ animationDelay: `-${cell.delay}s` }}
          />
        ))}
      </g>

      <g className="pi-pixels">
        {piCells.map((cell, index) => (
          <path
            key={index}
            d={`M${cell.x} ${cell.y - 10}L${cell.x + 18} ${cell.y}L${cell.x} ${cell.y + 10}L${cell.x - 18} ${cell.y}Z`}
            fill="#fff"
            stroke="#fff"
            strokeWidth="4"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}
