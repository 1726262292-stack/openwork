"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LibraryBig, Search } from "lucide-react";

import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { type TabItem, UnderlineTabs } from "../../_components/ui/tabs";
import { getOrgAccessFlags, getPluginRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { type LibraryAccessEdge, type LibraryPluginAccessItem, useLibraryAccess } from "./library-data";

type LibraryTab = "all" | "mine" | "shared" | "team" | "everyone";

const LIBRARY_TABS: readonly TabItem<LibraryTab>[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "Mine" },
  { value: "shared", label: "Shared with me" },
  { value: "team", label: "Team" },
  { value: "everyone", label: "Everyone" },
];

const EMPTY_TITLES: Record<LibraryTab, string> = {
  all: "Your library is empty.",
  mine: "You don’t have any plugins yet.",
  shared: "Nothing shared with you yet.",
  team: "Your teams don’t have any plugins yet.",
  everyone: "Nothing is available to everyone yet.",
};

function matchesTab(item: LibraryPluginAccessItem, tab: LibraryTab): boolean {
  if (tab === "all") return true;
  if (tab === "mine") return item.edges.some((edge) => edge.kind === "mine");
  if (tab === "shared") return item.edges.some((edge) => edge.kind === "person");
  if (tab === "team") return item.edges.some((edge) => edge.kind === "team");
  return item.edges.some((edge) => edge.kind === "org_wide" || edge.kind === "catalog");
}

function sourceRepositoryName(value: string | null): string | null {
  if (!value) return null;
  try {
    const pathParts = new URL(value).pathname.split("/").filter(Boolean);
    const owner = pathParts[0];
    const repository = pathParts[1]?.replace(/\.git$/, "");
    return owner && repository ? `${owner}/${repository}` : null;
  } catch {
    return null;
  }
}

function EdgeChip({ edge }: { edge: LibraryAccessEdge }) {
  if (edge.kind === "mine") {
    return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-medium text-emerald-700">Yours</span>;
  }
  if (edge.kind === "person") {
    return <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11.5px] font-medium text-blue-700">Shared by {edge.sharedBy?.name ?? "someone"}</span>;
  }
  if (edge.kind === "team") {
    return <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11.5px] font-medium text-gray-600">Team: {edge.team.name}</span>;
  }
  if (edge.kind === "catalog") {
    return <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11.5px] font-medium text-blue-700">Catalog: {edge.marketplace.name}</span>;
  }
  return <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-medium text-emerald-700">Everyone</span>;
}

function LibraryCard({ item, isAdmin, orgSlug }: { item: LibraryPluginAccessItem; isAdmin: boolean; orgSlug: string | null }) {
  const sourceName = sourceRepositoryName(item.plugin.sourceRepositoryUrl);
  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-gray-950">{item.plugin.name}</h2>
        <span className="shrink-0 text-[11.5px] text-gray-400">
          {item.plugin.componentCount} {item.plugin.componentCount === 1 ? "component" : "components"}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 min-h-10 text-[13px] leading-5 text-gray-500">
        {item.plugin.description ?? "No description provided."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {item.edges.map((edge, index) => <EdgeChip key={`${edge.kind}-${index}`} edge={edge} />)}
        {sourceName ? (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11.5px] font-medium text-gray-600">
            From {sourceName}
          </span>
        ) : null}
      </div>
    </>
  );
  const className = `block rounded-2xl border border-gray-200 bg-white p-5 ${isAdmin ? "transition-colors hover:border-gray-400" : ""}`;

  return isAdmin ? (
    <Link href={getPluginRoute(orgSlug, item.plugin.id)} className={className}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function LibraryScreen() {
  const { orgContext, orgSlug } = useOrgDashboard();
  const { data: items = [], isLoading, error } = useLibraryAccess();
  const [activeTab, setActiveTab] = useState<LibraryTab>("all");
  const [query, setQuery] = useState("");
  const access = getOrgAccessFlags(
    orgContext?.currentMember.role ?? "member",
    orgContext?.currentMember.isOwner ?? false,
    orgContext?.roles,
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = useMemo(
    () => items.filter((item) => {
      if (!matchesTab(item, activeTab)) return false;
      if (!normalizedQuery) return true;
      return item.plugin.name.toLowerCase().includes(normalizedQuery)
        || item.plugin.description?.toLowerCase().includes(normalizedQuery) === true;
    }),
    [activeTab, items, normalizedQuery],
  );

  return (
    <DashboardPageTemplate
      icon={LibraryBig}
      title="Library"
      description="Everything you can use in chat — yours, shared with you, from your teams, and org-wide."
      colors={["#DBEAFE", "#1E3A8A", "#2563EB", "#A7F3D0"]}
    >
      <div className="mb-6 space-y-4">
        <div className="overflow-x-auto">
          <UnderlineTabs
            className="min-w-max [&>nav]:flex-nowrap"
            tabs={LIBRARY_TABS}
            activeTab={activeTab}
            onChange={setActiveTab}
          />
        </div>
        <DenInput
          type="search"
          icon={Search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your library..."
        />
      </div>

      {error ? (
        <DenNotice
          tone="error"
          message={error instanceof Error ? error.message : "Failed to load library."}
        />
      ) : isLoading ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-10 text-[14px] text-gray-500">
          Loading your library…
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
          <p className="text-[15px] font-medium text-gray-900">
            {normalizedQuery ? "No plugins match that search." : EMPTY_TITLES[activeTab]}
          </p>
          <p className="mt-2 text-[13px] text-gray-500">
            {normalizedQuery ? "Try a different name or description." : "Plugins you can use in chat will appear here."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visibleItems.map((item) => (
            <LibraryCard key={item.plugin.id} item={item} isAdmin={access.isAdmin} orgSlug={orgSlug} />
          ))}
        </div>
      )}
    </DashboardPageTemplate>
  );
}
