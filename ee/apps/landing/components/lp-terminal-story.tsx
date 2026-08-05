"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const terminalLineCount = 9;

function TerminalLine({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="text-[#e2e8f0]">
        <span className="text-[#7dd3fc]">❯</span> share my skills and MCPs with my OpenWork org
      </div>
    );
  }
  if (index === 1) {
    return <div className="text-[#e2e8f0]"><span className="text-[#34d399]">✓ found granola</span> MCP</div>;
  }
  if (index === 2) {
    return <div className="text-[#e2e8f0]">✓ packed <span className="text-[#fbbf24]">meeting-brief</span> skill from SKILL.md</div>;
  }
  if (index === 3) {
    return <div className="text-[#e2e8f0]">✓ added <span className="text-[#7dd3fc]">review-pr</span> command</div>;
  }
  if (index === 4) return <div className="mt-3 text-[#64748b]">› bundling</div>;
  if (index === 5) return <div className="pl-4 text-[#64748b]">mcp/granola.json</div>;
  if (index === 6) return <div className="pl-4 text-[#64748b]">skills/meeting-brief/SKILL.md</div>;
  if (index === 7) return <div className="pl-4 text-[#64748b]">commands/review-pr.md</div>;
  return <div className="mt-3 text-[#e2e8f0]">✓ Shared with your org — one link for the whole team</div>;
}

function TrafficLights() {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      <span className="h-2.5 w-2.5 rounded-full bg-[#fb7185]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]" />
    </div>
  );
}

export function LpTerminalStory() {
  const reduceMotion = useReducedMotion();
  const [started, setStarted] = useState(false);
  const [visibleLines, setVisibleLines] = useState(0);
  const [showTeammate, setShowTeammate] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (reduceMotion) {
      setVisibleLines(terminalLineCount);
      setShowTeammate(true);
      return;
    }
    if (!started) return;

    for (let index = 0; index < terminalLineCount; index += 1) {
      timers.current.push(setTimeout(() => setVisibleLines(index + 1), (index + 1) * 80));
    }
    timers.current.push(
      setTimeout(() => setShowTeammate(true), terminalLineCount * 80 + 600)
    );

    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current = [];
    };
  }, [reduceMotion, started]);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      onViewportEnter={() => setStarted(true)}
      transition={{ duration: reduceMotion ? 0 : 0.3 }}
      className="grid gap-6 lg:grid-cols-2"
    >
      <div className="min-h-[410px] overflow-hidden rounded-[24px] bg-[var(--lp-terminal)]">
        <div className="flex h-12 items-center gap-3 border-b border-white/10 px-5">
          <TrafficLights />
          <span className="mono text-[12px] text-[#94a3b8]">agent — terminal</span>
        </div>
        <div className="mono px-6 py-7 text-[13px] leading-[24px]">
          {Array.from({ length: visibleLines }, (_, index) => (
            <TerminalLine key={index} index={index} />
          ))}
          {started && visibleLines < terminalLineCount ? (
            <span className="inline-block h-[15px] w-[7px] animate-pulse bg-[#7dd3fc] align-middle" />
          ) : null}
        </div>
      </div>

      <div className="min-h-[410px] overflow-hidden rounded-[24px] bg-[var(--lp-tonal)]">
        <div className="flex h-12 items-center justify-between border-b border-[#e5e7eb] px-5">
          <div className="flex items-center gap-3">
            <TrafficLights />
            <span className="text-[12px] font-medium text-[var(--lp-muted)]">OpenWork</span>
          </div>
          <span className="text-[11.5px] text-[var(--lp-faint)]">Your teammate&apos;s view</span>
        </div>
        <motion.div
          initial={false}
          animate={{ opacity: showTeammate ? 1 : 0, y: showTeammate ? 0 : 8 }}
          transition={{ duration: reduceMotion ? 0 : 0.25 }}
          className="flex min-h-[362px] flex-col p-6"
          aria-hidden={!showTeammate}
        >
          <div className="max-w-[390px] rounded-[14px] bg-white px-4 py-3 text-[13px] leading-5 text-[var(--lp-ink)]">
            Prep a brief for tomorrow&apos;s Acme call from my meeting notes.
          </div>
          <div className="mt-5 space-y-2 text-[12px] leading-5 text-[var(--lp-faint)]">
            <div>› Queried the shared Granola MCP for meeting notes</div>
            <div>› Ran Meeting Brief Generator — shared by your team</div>
          </div>
          <p className="mt-5 max-w-[430px] text-[13px] leading-5 text-[var(--lp-ink)]">
            Your brief is ready — deal history, latest notes, and 3 talking points. Saved to your desktop.
          </p>
          <div className="mt-auto flex items-center justify-between gap-3 rounded-full bg-white py-1.5 pl-4 pr-1.5 text-[12.5px] text-[var(--lp-faint)]">
            <span>Describe your task</span>
            <span className="inline-flex h-8 items-center rounded-full bg-[var(--lp-ink)] px-4 text-[12px] font-medium text-white">Run Task</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
