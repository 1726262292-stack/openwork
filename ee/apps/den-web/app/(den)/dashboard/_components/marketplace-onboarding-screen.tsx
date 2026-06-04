"use client";

import Link from "next/link";
import { ArrowRight, Download, Github, Monitor, Puzzle, Sparkles, Store, Zap } from "lucide-react";
import {
  getGithubIntegrationRoute,
  getIntegrationsRoute,
  getMarketplacesRoute,
  getOrgDashboardRoute,
} from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useMarketplaces } from "./marketplace-data";

const ANTHROPIC_KNOWLEDGE_WORK_REPO = "https://github.com/anthropics/knowledge-work-plugins";
const OPENWORK_MCP_DOCS = "https://github.com/different-ai/openwork/blob/dev/docs/mcp-ui-control-profile.md";

export function MarketplaceOnboardingScreen() {
  const { activeOrg, orgSlug } = useOrgDashboard();
  const { data: marketplaces = [], isLoading } = useMarketplaces();

  return (
    <div className="mx-auto max-w-[1120px] px-3 pb-8 pt-3 sm:px-6 sm:pb-10 sm:pt-4 md:px-8">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-[24px] border border-[#dfe5f0] bg-[#07192C] text-white shadow-sm sm:rounded-[28px]">
        <div className="grid gap-5 p-5 sm:gap-6 sm:p-6 md:grid-cols-[1.3fr_0.7fr] md:p-10">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.26em] text-cyan-200">OpenWork Cloud</p>
            <h1 className="mt-3 max-w-2xl text-[28px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[36px] md:text-[46px]">
              You&apos;re all set.
            </h1>
            <p className="mt-2 max-w-xl text-[14px] leading-6 text-white/65 sm:mt-3 sm:text-[15px] sm:leading-7">
              We set up two starter marketplaces for {activeOrg?.name ?? "your team"}.
            </p>
            <div className="mt-4 grid gap-3 sm:mt-5 sm:flex sm:flex-wrap">
              <Link href={getMarketplacesRoute(orgSlug)} className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-[#07192C] transition hover:bg-white/90">
                View marketplaces <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href={getOrgDashboardRoute(orgSlug)} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-white/10">
                Go to dashboard
              </Link>
            </div>
          </div>

          <div className="rounded-[20px] border border-white/10 bg-white/[0.06] p-4 sm:rounded-[22px] sm:p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-300 text-[#07192C]">
                <Monitor className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[14px] font-semibold">Get the desktop app</p>
                <p className="mt-0.5 text-[12px] leading-5 text-white/55">Download OpenWork and sign in with this same account to sync your team extensions.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── OpenWork Models pitch ────────────────────────────────── */}
      <section className="mt-4 overflow-hidden rounded-[24px] border border-[#d7e2f5] bg-gradient-to-br from-[#F4F8FF] to-[#EEF3FF] p-5 shadow-sm sm:mt-6 sm:rounded-[28px] sm:p-6 md:p-8">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center md:gap-8">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#07192C] text-amber-300">
                <Sparkles className="h-4 w-4" />
              </div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#41618F]">OpenWork Models</p>
            </div>
            <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.03em] text-[#07192C] sm:text-[24px]">
              Below-market-rate AI models, ready to go.
            </h2>
            <p className="mt-2 text-[13px] leading-6 text-[#526582] sm:text-[14px]">
              The best open-source and frontier models to get work done. No API keys needed to start.
              Prefer your own provider? Bring your own keys instead.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row md:flex-col">
            <Link href={`/dashboard/inference`} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#07192C] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_14px_32px_-20px_rgba(1,22,39,0.45)] transition hover:bg-black">
              <Zap className="h-4 w-4" /> Enable OpenWork Models
            </Link>
            <Link href={`/dashboard/custom-llm-providers`} className="inline-flex items-center justify-center gap-2 rounded-full border border-[#d8e0ec] px-5 py-2.5 text-[13px] font-semibold text-[#07192C] transition hover:bg-white">
              Use your own keys
            </Link>
          </div>
        </div>
      </section>

      {/* ── Starter marketplace cards ────────────────────────────── */}
      <section className="mt-4 grid gap-3 sm:mt-6 sm:gap-4 md:grid-cols-2">
        {(isLoading ? [] : marketplaces).map((marketplace) => {
          const isOpenWork = marketplace.name === "OpenWork Marketplace";
          const description = isOpenWork
            ? "Built-in tools like Browser, Image Gen, and Google Workspace."
            : marketplace.pluginCount > 0
              ? marketplace.description
              : "Connect a GitHub repo to import plugins here.";
          return (
            <Link
              key={marketplace.id}
              href={`${getMarketplacesRoute(orgSlug)}/${encodeURIComponent(marketplace.id)}`}
              className="rounded-[20px] border border-[#e2e7f0] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#cfd8e8] hover:shadow-md sm:rounded-[22px] sm:p-5"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#EDF4FF] text-[#164B8F]">
                  <Store className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[#07192C]">{isOpenWork ? "OpenWork Marketplace" : "Community Plugins"}</h2>
                    <span className="shrink-0 text-[12px] font-medium text-[#667695]">{marketplace.pluginCount} ext{marketplace.pluginCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
              </div>
              {description ? <p className="mt-2.5 text-[13px] leading-6 text-[#5C6B86]">{description}</p> : null}
            </Link>
          );
        })}
        {isLoading ? (
          <div className="rounded-[22px] border border-[#e2e7f0] bg-white p-5 text-[13px] text-[#667695] shadow-sm">Loading...</div>
        ) : null}
      </section>

      {/* ── Next steps ───────────────────────────────────────────── */}
      <section className="mt-4 grid gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-3">
        <ActionCard
          icon={<Download className="h-5 w-5" />}
          title="Get the app"
          body="Free download. Sign in to unlock your team marketplaces."
          href={getOrgDashboardRoute(orgSlug)}
          label="Download"
        />
        <ActionCard
          icon={<Github className="h-5 w-5" />}
          title="Import from GitHub"
          body="Connect a repo and import plugins to your marketplace."
          href={getGithubIntegrationRoute(orgSlug)}
          label="Connect GitHub"
        />
        <ActionCard
          icon={<Puzzle className="h-5 w-5" />}
          title="Add integrations"
          body="Package skills, agents, or MCPs as plugins."
          href={getIntegrationsRoute(orgSlug)}
          label="Browse integrations"
        />
      </section>

      {/* ── Starter repo + MCP (compact) ─────────────────────────── */}
      <section className="mt-4 grid gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-2">
        <div className="rounded-[20px] border border-[#e2e7f0] bg-white p-5 shadow-sm sm:rounded-[22px] sm:p-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#6C7890]">Starter repo</p>
          <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#07192C]">Try Knowledge Work Plugins</h2>
          <p className="mt-2 text-[13px] leading-6 text-[#5C6B86]">
            A GitHub repo with example plugins. Connect it to see how import works.
          </p>
          <a href={ANTHROPIC_KNOWLEDGE_WORK_REPO} target="_blank" rel="noreferrer" className="mt-3 inline-flex max-w-full items-center gap-2 text-[13px] font-semibold text-[#164B8F] transition hover:text-[#0F376C]">
            Open on GitHub <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <div className="rounded-[20px] border border-[#d7e2f5] bg-[#F4F8FF] p-5 shadow-sm sm:rounded-[22px] sm:p-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#41618F]">Use with any AI app</p>
          <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#07192C]">OpenWork MCP</h2>
          <p className="mt-2 text-[13px] leading-6 text-[#526582]">
            Add the MCP server to Claude, Cursor, or any app that supports MCP.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-[#07192C] px-4 py-3 text-[12px] leading-6 text-cyan-100"><code>npx openwork-ui-mcp</code></pre>
          <a href={OPENWORK_MCP_DOCS} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-[13px] font-semibold text-[#164B8F] transition hover:text-[#0F376C]">
            Read docs <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>
    </div>
  );
}

function ActionCard({ icon, title, body, href, label }: {
  icon: React.ReactNode;
  title: string;
  body: string;
  href: string;
  label: string;
}) {
  return (
    <Link href={href} className="flex items-start gap-4 rounded-[20px] border border-[#e2e7f0] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#cfd8e8] hover:shadow-md sm:rounded-[22px] sm:p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#07192C] text-white">{icon}</div>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[#07192C]">{title}</h2>
        <p className="mt-1 text-[13px] leading-5 text-[#5C6B86]">{body}</p>
        <span className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[#164B8F]">
          {label} <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}
