"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Bot, Check, Copy, Github, Monitor, Search, Store, Users } from "lucide-react";
import { PaperMeshGradient } from "@openwork/ui/react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenInput } from "../../_components/ui/input";
import { getMarketplaceRoute, getMarketplaceSourcesRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useHasAnyIntegration } from "./integration-data";
import { MarketplaceAreaTabs } from "./marketplace-area-tabs";
import { formatMarketplaceTimestamp, useMarketplaces } from "./marketplace-data";

export function MarketplacesScreen({ mcpUrl }: { mcpUrl: string | null }) {
  const { orgSlug } = useOrgDashboard();
  const { data: marketplaces = [], isLoading, error } = useMarketplaces();
  const { hasAny: hasAnyIntegration, isLoading: integrationsLoading } = useHasAnyIntegration();
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!normalizedQuery) return marketplaces;
    return marketplaces.filter((marketplace) =>
      `${marketplace.name}\n${marketplace.description ?? ""}`.toLowerCase().includes(normalizedQuery),
    );
  }, [marketplaces, normalizedQuery]);

  const showGuide = !hasAnyIntegration || marketplaces.length === 0;

  return (
    <DashboardPageTemplate
      icon={Store}
      badgeLabel="Preview"
      title="Marketplaces"
      description="Marketplaces contain plugins. OpenWork Marketplace is built in, and assigned marketplaces show up inside the desktop app after sign-in."
      colors={["#FEF3C7", "#92400E", "#F59E0B", "#FDE68A"]}
    >
      <MarketplaceAreaTabs active="marketplaces" />

      {error ? (
        <div className="mb-6 rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-[14px] text-red-700">
          {error instanceof Error ? error.message : "Failed to load marketplaces."}
        </div>
      ) : null}

      {isLoading || integrationsLoading ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-10 text-[14px] text-gray-500">
          Loading marketplaces…
        </div>
      ) : (
        <>
          {showGuide ? (
            <GuidedArrivalPanel sourcesHref={getMarketplaceSourcesRoute(orgSlug)} mcpUrl={mcpUrl} />
          ) : null}

          {marketplaces.length > 0 ? (
            <>
              <div className="mb-6">
                <DenInput
                  type="search"
                  icon={Search}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search marketplaces..."
                />
              </div>

              {filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
                  <p className="text-[15px] font-semibold tracking-[-0.02em] text-gray-900">
                    No marketplaces match that search
                  </p>
                  <p className="mx-auto mt-2 max-w-[520px] text-[13px] leading-6 text-gray-500">
                    Try a different search term or open the plugins tab.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {filtered.map((marketplace) => (
                    <Link
                      key={marketplace.id}
                      href={getMarketplaceRoute(orgSlug, marketplace.id)}
                      className="group block overflow-hidden rounded-2xl border border-gray-100 bg-white transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.12)]"
                    >
                      <div className="flex items-stretch">
                        <div className="relative w-[68px] shrink-0 overflow-hidden">
                          <div className="absolute inset-0">
                            <PaperMeshGradient seed={marketplace.id} speed={0} />
                          </div>
                          <div className="relative flex h-full items-center justify-center">
                            <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/60 bg-white shadow-[0_8px_20px_-8px_rgba(15,23,42,0.3)]">
                              <Store className="h-4 w-4 text-gray-700" aria-hidden />
                            </div>
                          </div>
                        </div>

                        <div className="min-w-0 flex-1 px-5 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-gray-900">
                              {marketplace.name}
                            </h2>
                            <span className="shrink-0 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
                              {marketplace.pluginCount} plugin{marketplace.pluginCount === 1 ? "" : "s"}
                            </span>
                          </div>
                          {marketplace.description ? (
                            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.55] text-gray-500">
                              {marketplace.description}
                            </p>
                          ) : null}
                          <p className="mt-3 text-[11.5px] text-gray-400">
                            Added {formatMarketplaceTimestamp(marketplace.createdAt)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </>
      )}
    </DashboardPageTemplate>
  );
}

function GuidedArrivalPanel({ sourcesHref, mcpUrl }: { sourcesHref: string; mcpUrl: string | null }) {
  return (
    <section className="mb-8 overflow-hidden rounded-[22px] border border-[#e2e7f0] bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-5">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#6C7890]">
          What can live here
        </p>
        <p className="mt-1.5 text-[14px] leading-6 text-gray-700">
          Skills, agents, commands, and MCP servers — anything your team builds. They are packaged
          as plugins, and marketplaces are how you share them with your team.
        </p>
      </div>

      <div className="px-6 py-5">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-[#6C7890]">
          How things get here
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          <Link
            href={sourcesHref}
            className="flex flex-col rounded-2xl border border-gray-100 bg-gray-50/60 p-4 transition hover:-translate-y-0.5 hover:border-gray-200 hover:bg-white hover:shadow-md"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#07192C] text-white">
              <Github className="h-4 w-4" />
            </div>
            <p className="mt-3 text-[14px] font-semibold tracking-[-0.01em] text-gray-900">
              Connect GitHub
            </p>
            <p className="mt-1 text-[12.5px] leading-5 text-gray-500">
              Link a repository and OpenWork imports the plugins it finds there.
            </p>
            <span className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#164B8F]">
              Open Sources <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>

          <div className="flex flex-col rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#07192C] text-white">
              <Monitor className="h-4 w-4" />
            </div>
            <p className="mt-3 text-[14px] font-semibold tracking-[-0.01em] text-gray-900">
              Share from the desktop app
            </p>
            <p className="mt-1 text-[12.5px] leading-5 text-gray-500">
              Build something in the OpenWork desktop app, then publish it to your team from there.
            </p>
          </div>

          <div className="flex flex-col rounded-2xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#07192C] text-white">
              <Bot className="h-4 w-4" />
            </div>
            <p className="mt-3 text-[14px] font-semibold tracking-[-0.01em] text-gray-900">
              Your agent can publish here
            </p>
            <p className="mt-1 text-[12.5px] leading-5 text-gray-500">
              Connect the OpenWork Cloud MCP to any AI app and ask the agent to publish skills and
              plugins for you.
            </p>
            {mcpUrl ? <CopyableMcpUrl url={mcpUrl} /> : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-6 py-4">
        <Users className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <p className="text-[12.5px] leading-5 text-gray-500">
          <span className="font-semibold text-gray-700">Who sees it:</span> you choose for each
          marketplace — everyone in your org, or only specific people and teams.
        </p>
      </div>
    </section>
  );
}

function CopyableMcpUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      return;
    }
  }

  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#07192C] py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 truncate text-[11.5px] text-cyan-100">{url}</code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label="Copy MCP URL"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white"
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </div>
  );
}
