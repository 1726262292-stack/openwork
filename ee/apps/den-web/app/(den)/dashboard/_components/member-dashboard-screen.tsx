"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import { formatRoleLabel } from "../../_lib/den-org";
import { useDenFlow } from "../../_providers/den-flow-provider";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useOrgLlmProviders } from "./llm-provider-data";
import { useMarketplaces } from "./marketplace-data";
import { MemberOnboardingCard, useMemberOnboarding } from "./member-onboarding-card";
import { getPluginPartsSummary, usePlugins } from "./plugin-data";

function getErrorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function cleanDescription(description: string): string {
  const firstParagraph = description.split(/\n\s*\n/)[0].trim();
  return firstParagraph.length > 0 ? firstParagraph : description.trim();
}

function getRoleArticle(roleLabel: string): "a" | "an" {
  return /^[aeiou]/i.test(roleLabel) ? "an" : "a";
}

function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-800">
      {children}
    </div>
  );
}

export function MemberDashboardScreen() {
  const { user } = useDenFlow();
  const { activeOrg, orgContext, orgId } = useOrgDashboard();
  const { llmProviders, busy: providersBusy, error: providersError } = useOrgLlmProviders(orgId, { scope: "usable" });
  const { data: marketplaces = [], isLoading: marketplacesLoading, error: marketplacesError } = useMarketplaces();
  const { data: plugins = [], isLoading: pluginsLoading, error: pluginsError } = usePlugins();
  const { ready, installed, dismissed, markInstalled, reopen, dismiss } = useMemberOnboarding(orgId);
  const showOnboarding = ready && !dismissed;
  const memberEmail = user?.email ?? "";

  const customProviders = llmProviders.filter((provider) => provider.source !== "openwork");
  const openWorkProviders = llmProviders.filter((provider) => provider.source === "openwork");

  const currentMember = orgContext?.currentMember;
  const teamNames = orgContext?.currentMemberTeams.map((team) => team.name).sort((a, b) => a.localeCompare(b)) ?? [];
  const roleLabel = currentMember ? formatRoleLabel(currentMember.role) : "Member";
  const roleWord = roleLabel.toLowerCase();
  const organizationName = activeOrg?.name ?? orgContext?.organization.name ?? "your workspace";
  const installLinksEnabled = orgContext?.capabilities.installLinks === true;
  const hasOpenWorkModels = openWorkProviders.length > 0;
  const hasCustomProviders = customProviders.length > 0;
  const hasModelResources = hasOpenWorkModels || hasCustomProviders;
  const hasMarketplaces = marketplaces.length > 0;
  const hasPlugins = plugins.length > 0;
  const hasResources = hasModelResources || hasMarketplaces || hasPlugins;
  const hasAnyResourceLoading = providersBusy || marketplacesLoading || pluginsLoading;
  const hasResourceErrors = Boolean(providersError || marketplacesError || pluginsError);
  const modelSummaryParts = [
    hasOpenWorkModels ? "OpenWork Models" : null,
    hasCustomProviders ? `${customProviders.length} custom provider${customProviders.length === 1 ? "" : "s"}` : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-4 sm:px-6 md:px-8" data-testid="member-dashboard">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-[#e7e9f0] pb-3">
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-[#07192C]">
          {activeOrg?.name ?? "OpenWork Cloud"}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-[#9AA5BA]" aria-hidden="true" />
        <span className="text-[14px] font-medium tracking-[-0.01em] text-[#5A6886]">Dashboard</span>
      </div>

      {showOnboarding && orgId ? (
        <div className="mt-5">
          <MemberOnboardingCard
            organizationId={orgId}
            organizationName={organizationName}
            memberEmail={memberEmail}
            installLinksEnabled={installLinksEnabled}
            collapsed={false}
            installed={installed}
            onMarkInstalled={markInstalled}
            onDismiss={dismiss}
            onReopen={reopen}
          />
        </div>
      ) : (
        <>
          {ready && orgId ? (
            <div className="mt-5">
              <MemberOnboardingCard
                organizationId={orgId}
                organizationName={organizationName}
                memberEmail={memberEmail}
                installLinksEnabled={installLinksEnabled}
                collapsed
                installed={installed}
                onMarkInstalled={markInstalled}
                onDismiss={dismiss}
                onReopen={reopen}
              />
            </div>
          ) : null}

          <div className="mt-4">
            <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[#07192C]">Your workspace</h1>
            <p className="mt-1 max-w-[680px] text-[14px] leading-6 text-[#5A6886]">
              Everything your team set up for you — ready when you open the OpenWork desktop app.
            </p>
            <p className="mt-1 text-[13px] leading-5 text-[#5A6886]">
              You&apos;re {getRoleArticle(roleWord)} {roleWord} of {organizationName}
              {teamNames.length > 0 ? ` · ${teamNames.join(", ")}` : ""}
            </p>
          </div>

          {hasResourceErrors ? (
            <div className="mt-5 grid gap-3">
              {providersError ? <ErrorNotice>{providersError}</ErrorNotice> : null}
              {marketplacesError ? <ErrorNotice>{getErrorText(marketplacesError)}</ErrorNotice> : null}
              {pluginsError ? <ErrorNotice>{getErrorText(pluginsError)}</ErrorNotice> : null}
            </div>
          ) : null}

          {hasAnyResourceLoading && !hasResources ? (
            <p className="mt-5 text-[13px] leading-5 text-gray-500">Loading your resources...</p>
          ) : null}
          {!hasAnyResourceLoading && !hasResources ? (
            <p className="mt-5 text-[13px] leading-5 text-gray-500" data-testid="member-resources-empty">
              Your team hasn&apos;t shared models, plugins, or marketplaces yet. You can still use OpenWork with your own setup.
            </p>
          ) : null}

          {hasResources ? (
            <div className="mt-5 space-y-5" data-testid="member-resource-overview">
              {hasModelResources ? (
                <section
                  className="flex items-center justify-between gap-4 rounded-2xl border border-gray-100 bg-white px-4 py-3"
                  data-testid="member-models-summary"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#f4f7fb] text-[#07192C]">
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <p className="text-[14px] font-semibold text-[#07192C]">AI models</p>
                  </div>
                  <p className="shrink-0 text-right text-[12px] leading-5 text-[#5A6886]">{modelSummaryParts.join(" · ")}</p>
                </section>
              ) : null}

              {hasPlugins ? (
                <section>
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-[#07192C]">Skills and tools</h2>
                    <p className="text-[12px] text-[#5A6886]">{plugins.length} available</p>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white divide-y divide-gray-100" data-testid="member-plugin-list">
                    {plugins.slice(0, 8).map((plugin) => (
                      <div key={plugin.id} className="px-4 py-3.5">
                        <p className="truncate text-[14px] font-semibold text-gray-950">{plugin.name}</p>
                        <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-gray-500">{cleanDescription(plugin.description)}</p>
                        <p className="mt-2 text-[12px] text-gray-400">{getPluginPartsSummary(plugin)}</p>
                      </div>
                    ))}
                    {plugins.length > 8 ? (
                      <p className="px-4 py-3 text-[12px] leading-5 text-gray-400">
                        Showing 8 of {plugins.length} — all of them sync into the desktop app.
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {hasMarketplaces ? (
                <p className="text-[12px] leading-5 text-gray-400" data-testid="member-marketplace-note">
                  Delivered from {marketplaces.length} marketplace{marketplaces.length === 1 ? "" : "s"}: {marketplaces.map((marketplace) => marketplace.name).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
