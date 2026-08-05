"use client";

import { motion, useReducedMotion } from "framer-motion";

import { LpAlphaBadge } from "./lp-primitives";
import { OpenWorkMark } from "./openwork-mark";

type CoworkSupport = "check" | "none" | "limited";

type ParityRow = {
  capability: string;
  cowork: CoworkSupport;
  badge?: "alpha" | "openwork";
  highlighted?: boolean;
};

const rows: ParityRow[] = [
  { capability: "Chat on your files and tools", cowork: "check" },
  { capability: "Claude models (Sonnet, Opus, Haiku)", cowork: "check" },
  { capability: "GPT-5, Gemini, Mistral, and local models", cowork: "none" },
  { capability: "Scheduled tasks", cowork: "check", badge: "alpha" },
  { capability: "Browser automation", cowork: "limited" },
  { capability: "Anthropic-compatible plugins and skills", cowork: "check" },
  { capability: "Instant org-wide skill and MCP sharing", cowork: "none" },
  {
    capability: "MCP gateway usable from any client",
    cowork: "none",
    badge: "openwork",
    highlighted: true
  },
  { capability: "Self-host or managed private instance", cowork: "none" },
  { capability: "Open source — audit it, fork it, own it", cowork: "none" }
];

function OpenWorkCheck({ delay }: { delay: number }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      initial={reduceMotion ? false : { scale: 0.8, opacity: 0 }}
      whileInView={{ scale: 1, opacity: 1 }}
      viewport={{ once: true, amount: 0.8 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, delay: reduceMotion ? 0 : delay }}
      className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--lp-ink)] text-white"
      aria-label="Included"
    >
      <svg
        viewBox="0 0 12 12"
        className="h-2.5 w-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m2.2 6.2 2.3 2.2 5.2-5" />
      </svg>
    </motion.span>
  );
}

function CoworkCell({ support }: { support: CoworkSupport }) {
  if (support === "limited") {
    return <span className="text-[13px] text-[var(--lp-faint)]">Limited</span>;
  }

  if (support === "none") {
    return <span className="text-[15px] text-[var(--lp-faint)]">—</span>;
  }

  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4 text-[var(--lp-faint)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Included"
    >
      <path d="m3 8 3 3 7-7" />
    </svg>
  );
}

export function LpParityTable() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="flex items-center border-y border-[var(--lp-border)] px-5 py-3.5">
          <div className="flex-1 text-[12px] font-semibold tracking-[0.1em] text-[var(--lp-faint)]">
            CAPABILITY
          </div>
          <div className="flex w-40 items-center justify-center gap-2 text-[13px] font-semibold text-[var(--lp-ink)]">
            <OpenWorkMark className="h-5 w-5 object-contain" />
            OpenWork
          </div>
          <div className="w-40 text-center text-[13px] font-medium text-[var(--lp-muted)]">
            Claude Cowork
          </div>
        </div>

        {rows.map((row, index) => (
          <motion.div
            key={row.capability}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.35 }}
            transition={{ duration: reduceMotion ? 0 : 0.24, delay: reduceMotion ? 0 : index * 0.04 }}
            className={`group flex items-center border-b border-[#f1f5f9] px-5 py-[15px] transition-colors duration-150 hover:bg-[var(--lp-tonal)] ${
              row.highlighted ? "rounded-[10px] bg-[#f0f7ff]" : ""
            }`}
          >
            <div
              className={`flex flex-1 items-center gap-2 text-[15px] text-[var(--lp-ink)] ${
                row.highlighted ? "font-semibold" : "font-normal"
              }`}
            >
              <span>{row.capability}</span>
              {row.badge === "alpha" ? <LpAlphaBadge /> : null}
              {row.badge === "openwork" ? (
                <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[9.5px] font-bold tracking-[0.08em] text-[var(--lp-blue)]">
                  OPENWORK ONLY
                </span>
              ) : null}
            </div>
            <div className="flex w-40 justify-center">
              <OpenWorkCheck delay={index * 0.04 + 0.06} />
            </div>
            <div className="flex w-40 justify-center">
              <CoworkCell support={row.cowork} />
            </div>
          </motion.div>
        ))}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 pt-4 text-[13px] text-[var(--lp-faint)]">
          <span>
            Migrating from Cowork? Your SKILL.md files and MCP servers work as-is.
          </span>
          <a
            href="/docs"
            className="text-[var(--lp-ink)] underline decoration-1 underline-offset-4"
          >
            See the migration guide
          </a>
        </div>
      </div>
    </div>
  );
}
