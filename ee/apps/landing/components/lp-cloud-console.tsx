"use client";

import { ChevronRight } from "lucide-react";

import { BrandLogo } from "./lp-brand-logos";

const sidebarItems = [
  { label: "Dashboard" },
  { label: "Library" },
  { label: "Your Connections", badge: "BETA" },
  { label: "Web", badge: "ALPHA" },
  { label: "Extensions" },
  { label: "Models", expandable: true },
  { label: "OpenWork Models", child: true },
  { label: "Bring your Own Keys", child: true, active: true },
  { label: "Members" },
  { label: "Analytics" },
  { label: "Settings" }
];

type Provider = {
  name: string;
  detail: string;
  logo: "aws" | "openrouter" | "azure";
  delay: string;
};

const providers: Provider[] = [
  { name: "AWS Bedrock", detail: "12 models · all teams", logo: "aws", delay: "0s" },
  { name: "Azure AI Foundry", detail: "8 models · engineering only", logo: "azure", delay: "-1.3s" },
  { name: "OpenRouter", detail: "40+ models · spend limit $500/mo", logo: "openrouter", delay: "-2.6s" }
];

function TrafficLights() {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      <span className="h-2.5 w-2.5 rounded-full bg-[#fb7185]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]" />
    </div>
  );
}

export function LpCloudConsole() {
  return (
    <div className="overflow-hidden rounded-[20px] bg-white shadow-[0_24px_48px_rgba(1,22,39,0.10)]">
      <div className="flex h-12 items-center gap-3 border-b border-[#e1e4e8] px-5">
        <TrafficLights />
        <span className="text-[12px] font-medium text-[var(--lp-muted)]">OpenWork Cloud — Acme Inc</span>
      </div>
      <div className="flex min-h-[570px]">
        <aside className="hidden w-[200px] shrink-0 flex-col border-r border-[#e1e4e8] bg-[#f7f8fa] p-3 md:flex">
          <div className="flex items-center gap-2.5 rounded-[11px] bg-white p-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--lp-ink)] text-[12px] font-semibold text-white">A</span>
            <div>
              <div className="text-[12.5px] font-medium text-[var(--lp-ink)]">Acme Inc</div>
              <span className="rounded-full bg-[#eff6ff] px-1.5 py-0.5 text-[8px] font-bold tracking-[0.08em] text-[var(--lp-blue)]">CLOUD</span>
            </div>
          </div>
          <div className="px-2 pb-2 pt-5 text-[10px] font-semibold tracking-[0.14em] text-[var(--lp-faint)]">NAVIGATION</div>
          <nav className="flex flex-col gap-0.5">
            {sidebarItems.map((item) => (
              <div
                key={item.label}
                className={`flex h-8 items-center justify-between rounded-[8px] px-2 text-[12.5px] transition-none hover:bg-[#eceff3] ${
                  item.child ? "ml-3 pl-3" : ""
                } ${item.active ? "border border-[#e1e4e8] bg-white font-medium text-[var(--lp-ink)]" : "text-[var(--lp-muted)]"}`}
              >
                <span>{item.label}</span>
                {item.badge ? <span className="text-[8px] font-bold tracking-[0.08em] text-[var(--lp-blue)]">{item.badge}</span> : null}
                {item.expandable ? <ChevronRight className="h-3 w-3" aria-hidden="true" /> : null}
              </div>
            ))}
          </nav>
          <div className="mt-auto flex items-center gap-2 rounded-[10px] bg-white p-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--lp-ink)] text-[10px] text-white">A</span>
            <div><div className="text-[11.5px] font-medium text-[var(--lp-ink)]">Acme Inc</div><div className="text-[10px] text-[var(--lp-faint)]">Owner</div></div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 bg-white p-5 sm:p-8 lg:p-10">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h2 className="text-[15.5px] font-semibold text-[var(--lp-ink)]">Bring your Own Keys</h2>
              <p className="mt-1 text-[12px] text-[var(--lp-muted)]">Models › provisioned for every seat — keys never leave the org.</p>
            </div>
            <button type="button" className="inline-flex h-8 items-center self-start rounded-full bg-[var(--lp-ink)] px-4 text-[12px] font-medium text-white active:scale-[0.97]">Add provider</button>
          </div>

          <div className="mt-8 flex flex-col gap-3">
            {providers.map((provider) => (
              <div key={provider.name} className="group flex min-h-[68px] items-center gap-3 rounded-[10px] border border-[#f1f5f9] px-3.5 py-2.5 transition-colors duration-150 hover:bg-[#f8fafc]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#f1f5f9] text-[var(--lp-muted)]">
                  {provider.logo === "azure" ? <span className="text-[12px] font-semibold">Az</span> : <BrandLogo name={provider.logo} className="h-[18px] w-[18px]" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[var(--lp-ink)]">{provider.name}</div>
                  <div className="mt-0.5 text-[11.5px] text-[var(--lp-muted)]">{provider.detail}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden text-[11.5px] font-medium text-[var(--lp-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 sm:inline">Manage →</span>
                  <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#059669]">
                    <span className="lp-cloud-status-dot h-2 w-2 rounded-full bg-[#10b981]" style={{ animationDelay: provider.delay }} />
                    Connected
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-[12px] bg-[var(--lp-tonal)] p-5">
            <div className="text-[11px] font-semibold tracking-[0.1em] text-[var(--lp-muted)]">ORG DEFAULT</div>
            <div className="mt-3 flex items-center justify-between gap-4">
              <div><div className="text-[13px] font-medium text-[var(--lp-ink)]">Claude Sonnet 4.5</div><div className="mt-1 text-[11.5px] text-[var(--lp-muted)]">AWS Bedrock · available to all teams</div></div>
              <span className="rounded-full bg-white px-3 py-1.5 text-[11px] text-[var(--lp-muted)]">Edit policy</span>
            </div>
          </div>
        </div>
      </div>
      <style jsx>{`
        .lp-cloud-status-dot { animation: lp-cloud-pulse 4s ease-in-out infinite; }
        @keyframes lp-cloud-pulse { 0%, 12%, 100% { opacity: 1; transform: scale(1); } 6% { opacity: .45; transform: scale(.72); } }
        @media (prefers-reduced-motion: reduce) { .lp-cloud-status-dot { animation: none; } }
      `}</style>
    </div>
  );
}
