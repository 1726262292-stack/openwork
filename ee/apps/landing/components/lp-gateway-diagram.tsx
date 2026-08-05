import { Plug } from "lucide-react";

import { BrandLogo } from "./lp-brand-logos";
import { OpenWorkMark } from "./openwork-mark";

const sources = [
  { label: "Notion MCP", color: "bg-[#14b8a6]" },
  { label: "HubSpot MCP", color: "bg-[#14b8a6]" },
  { label: "Chrome MCP", color: "bg-[#14b8a6]" },
  { label: "Meeting Brief — skill", color: "bg-[#f59e0b]" }
];

function Connector() {
  return (
    <div className="flex h-8 min-w-10 flex-1 items-center md:h-auto">
      <div className="h-px flex-1 bg-[#c4ceda]" />
      <span
        aria-hidden="true"
        className="h-0 w-0 border-y-[4px] border-l-[6px] border-y-transparent border-l-[#c4ceda]"
      />
    </div>
  );
}

export function LpGatewayDiagram() {
  return (
    <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center md:gap-0">
      <div className="w-full rounded-[20px] bg-[var(--lp-tonal)] p-5 md:w-[320px] md:shrink-0">
        <div className="mb-3 text-[11px] font-bold tracking-[0.1em] text-[var(--lp-muted)]">
          SET UP ONCE
        </div>
        <div className="flex flex-col gap-2">
          {sources.map((source) => (
            <div
              key={source.label}
              className="flex items-center gap-3 rounded-[10px] bg-white px-3.5 py-2.5 text-[13.5px] font-medium text-[var(--lp-ink)]"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${source.color}`} />
              {source.label}
            </div>
          ))}
        </div>
      </div>

      <Connector />

      <div className="flex w-full shrink-0 flex-col items-center rounded-[20px] border-[1.5px] border-[var(--lp-ink)] bg-white px-5 py-[26px] text-center md:w-[216px]">
        <Plug className="mb-3 h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        <div className="text-[16px] font-semibold text-[var(--lp-ink)]">
          OpenWork Connect
        </div>
        <div className="mt-1 text-[11px] font-bold tracking-[0.1em] text-[var(--lp-blue)]">
          MCP GATEWAY
        </div>
        <p className="mt-3 text-[11.5px] leading-[17px] text-[var(--lp-muted)]">
          Auth, roles, and policies applied on the way through
        </p>
      </div>

      <Connector />

      <div className="w-full rounded-[20px] bg-[var(--lp-tonal)] p-5 md:w-[320px] md:shrink-0">
        <div className="mb-3 text-[11px] font-bold tracking-[0.1em] text-[var(--lp-muted)]">
          INSTANTLY SHARED WITH EVERYONE
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 rounded-[10px] bg-white px-3.5 py-2.5 text-[13.5px] font-medium text-[var(--lp-ink)]">
            <span className="flex w-4 shrink-0 justify-center">
              <OpenWorkMark className="h-4 w-4 object-contain" />
            </span>
            Teammates on desktop &amp; web
          </div>
          <ClientRow logo="claude" label="Claude Code" />
          <ClientRow logo="cursor" label="Cursor" />
          <ClientRow logo="openai" label="ChatGPT — any MCP client" />
        </div>
      </div>
    </div>
  );
}

type ClientRowProps = {
  logo: "claude" | "cursor" | "openai";
  label: string;
};

function ClientRow({ logo, label }: ClientRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] bg-white px-3.5 py-2.5 text-[13.5px] font-medium text-[var(--lp-ink)]">
      <span className="flex w-4 shrink-0 justify-center">
        <BrandLogo name={logo} className="h-3.5 w-3.5" />
      </span>
      {label}
    </div>
  );
}
