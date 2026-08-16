"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChevronRight, LibraryBig } from "lucide-react";

import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenChip } from "../../_components/ui/chip";
import { DenNotice } from "../../_components/ui/notice";
import { getLibraryDetailsRoute, getYourConnectionsRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import {
  type LibraryItem,
  type LibraryPluginItem,
  type LibrarySkillItem,
  useLibrary,
  useLibrarySkills,
} from "./library-data";
import { IconFlow, type IconFlowItem, RowFlow, type RowFlowItem } from "./library-flow";
import { type LibraryModelTile, useLibraryModels } from "./library-models-data";
import {
  getConnectionStatusLabel,
  getConnectionStatusTone,
  getReadinessState,
} from "./library-status";

/** Badge order and wording for plugin components. */
const COMPONENT_LABELS: readonly { kind: string; singular: string; plural: string }[] = [
  { kind: "skill", singular: "skill", plural: "skills" },
  { kind: "agent", singular: "agent", plural: "agents" },
  { kind: "command", singular: "command", plural: "commands" },
  { kind: "mcp", singular: "MCP", plural: "MCPs" },
  { kind: "tool", singular: "tool", plural: "tools" },
  { kind: "hook", singular: "hook", plural: "hooks" },
  { kind: "context", singular: "context", plural: "contexts" },
  { kind: "script", singular: "script", plural: "scripts" },
  { kind: "custom", singular: "custom", plural: "customs" },
];

function connectionIcons(items: LibraryItem[], orgSlug: string | null): IconFlowItem[] {
  return items.flatMap((item) => {
    if (item.type !== "connection") return [];
    // A member cannot act on a connection that is waiting on an admin, so the
    // summary leaves it out. It stays visible in the Connections tab.
    if (item.state === "needs_admin_setup") return [];
    return [{
      key: `connection-${item.id}`,
      name: item.name,
      statusLabel: getConnectionStatusLabel(item.state),
      tone: getConnectionStatusTone(item.state),
      iconUrl: item.provider === "google-workspace" ? "/integrations/google.svg" : undefined,
      simpleIconSlug: item.provider === "microsoft-365" ? "microsoft" : undefined,
      serviceUrl: item.transport === "mcp" ? item.url : null,
      // Straight to this connection on the page where a member acts on it,
      // matching what the expanded connection rows already link to.
      href: `${getYourConnectionsRoute(orgSlug)}?connectionId=${encodeURIComponent(item.id)}`,
    }];
  });
}

function modelIcons(tiles: LibraryModelTile[]): IconFlowItem[] {
  return tiles.map((tile) => ({
    key: tile.key,
    name: tile.label,
    // Models reaching this list are already granted to the caller.
    statusLabel: `Ready to use · ${tile.providerName}`,
    tone: "success",
    iconUrl: tile.iconUrl,
    simpleIconSlug: tile.simpleIconSlug,
    serviceUrl: tile.serviceUrl,
    overlayLabel: tile.label,
  }));
}

function skillRows(skills: LibrarySkillItem[]): RowFlowItem[] {
  return skills.map((skill) => ({ key: `skill-${skill.id}`, name: skill.title }));
}

function pluginBadges(plugin: LibraryPluginItem) {
  return COMPONENT_LABELS.flatMap(({ kind, singular, plural }) => {
    const count = plugin.componentCounts[kind] ?? 0;
    if (count === 0) return [];
    return [{ label: count === 1 ? singular : plural, count }];
  });
}

function pluginRows(items: LibraryItem[]): RowFlowItem[] {
  return items.flatMap((item) => {
    if (item.type !== "plugin") return [];
    return [{ key: `plugin-${item.id}`, name: item.name, badges: pluginBadges(item) }];
  });
}

function OverviewCard({
  title,
  count,
  href,
  isLoading,
  error,
  emptyLabel,
  children,
}: {
  title: string;
  count: number;
  href: string;
  isLoading: boolean;
  error: string | null;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-library-card={title.toLowerCase()}
      className="flex flex-col rounded-[16px] border border-gray-200 bg-white p-5"
    >
      <Link href={href} className="group mb-4 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-[13px] font-semibold uppercase tracking-[0.12em] text-gray-500 group-hover:text-gray-900">
            {title}
          </span>
          <span data-library-card-count className="text-[12px] font-semibold text-gray-400">{count}</span>
        </span>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-gray-900" />
      </Link>
      {error ? (
        <p className="text-[12.5px] text-red-600">{error}</p>
      ) : isLoading ? (
        <p className="text-[12.5px] text-gray-400">Loading…</p>
      ) : count === 0 ? (
        <p className="text-[12.5px] text-gray-400">{emptyLabel}</p>
      ) : children}
    </section>
  );
}

/**
 * The four-card summary. Rendered both as the Library landing page and as the
 * Overview tab of the detail page, so the two can never drift apart.
 */
export function LibraryOverviewCards() {
  const { orgSlug, orgId } = useOrgDashboard();
  const { data: items = [], isLoading: libraryLoading, error: libraryError } = useLibrary();
  const { data: skills = [], isLoading: skillsLoading, error: skillsError } = useLibrarySkills();
  const { tiles: modelTiles, isLoading: modelsLoading, error: modelsError } = useLibraryModels(orgId);

  const connections = useMemo(() => connectionIcons(items, orgSlug), [items, orgSlug]);
  const models = useMemo(() => modelIcons(modelTiles), [modelTiles]);
  const skillItems = useMemo(() => skillRows(skills), [skills]);
  const plugins = useMemo(() => pluginRows(items), [items]);

  const libraryErrorMessage = libraryError
    ? libraryError instanceof Error ? libraryError.message : "Failed to load library."
    : null;
  const skillsErrorMessage = skillsError
    ? skillsError instanceof Error ? skillsError.message : "Failed to load skills."
    : null;

  return (
    <>
      {libraryErrorMessage ? <DenNotice tone="error" message={libraryErrorMessage} /> : null}

      <div data-library-overview-grid className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <OverviewCard
          title="Connections"
          count={connections.length}
          href={getLibraryDetailsRoute(orgSlug, "connections")}
          isLoading={libraryLoading}
          error={libraryErrorMessage}
          emptyLabel="No connections shared with you yet."
        >
          <IconFlow items={connections} />
        </OverviewCard>

        <OverviewCard
          title="Models"
          count={models.length}
          href={getLibraryDetailsRoute(orgSlug, "models")}
          isLoading={modelsLoading}
          error={modelsError}
          emptyLabel="No models available to you yet."
        >
          <IconFlow items={models} />
        </OverviewCard>

        <OverviewCard
          title="Skills"
          count={skillItems.length}
          href={getLibraryDetailsRoute(orgSlug, "skills")}
          isLoading={skillsLoading}
          error={skillsErrorMessage}
          emptyLabel="No skills shared with you yet."
        >
          <RowFlow items={skillItems} />
        </OverviewCard>

        <OverviewCard
          title="Plugins"
          count={plugins.length}
          href={getLibraryDetailsRoute(orgSlug, "plugins")}
          isLoading={libraryLoading}
          error={libraryErrorMessage}
          emptyLabel="No plugins shared with you yet."
        >
          <RowFlow items={plugins} />
        </OverviewCard>
      </div>
    </>
  );
}

export function LibraryOverviewScreen() {
  const { data: items = [] } = useLibrary();
  const readyCount = useMemo(
    () => items.filter((item) => getReadinessState(item) === "ready").length,
    [items],
  );

  return (
    <DashboardPageTemplate
      icon={LibraryBig}
      badgeLabel="Member library"
      badgeCompanion={<DenChip tone="success">{readyCount} ready to use</DenChip>}
      title="Library"
      description="Everything you can use in chat — yours, shared with you, from your teams, and org-wide."
      colors={["#DBEAFE", "#1E3A8A", "#2563EB", "#A7F3D0"]}
    >
      <LibraryOverviewCards />
    </DashboardPageTemplate>
  );
}
