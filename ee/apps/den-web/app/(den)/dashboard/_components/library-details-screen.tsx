"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { LibraryBig } from "lucide-react";

import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenBrandMark } from "../../_components/ui/brand-mark";
import { DenChip } from "../../_components/ui/chip";
import { DenList, DenListRow } from "../../_components/ui/list-row";
import { DenNotice } from "../../_components/ui/notice";
import { type TabItem, UnderlineTabs } from "../../_components/ui/tabs";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { useLibrary, useLibrarySkills } from "./library-data";
import { LibraryOverviewCards } from "./library-overview-screen";
import { LibraryScreen } from "./library-screen";
import { type LibraryModelTile, useLibraryModels } from "./library-models-data";

const TABS = ["overview", "connections", "models", "skills", "plugins"] as const;
type LibraryDetailsTab = (typeof TABS)[number];

function parseTab(value: string | null): LibraryDetailsTab {
  return TABS.find((tab) => tab === value) ?? "overview";
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[10px] border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
      <p className="text-[15px] font-medium text-gray-900">{message}</p>
    </div>
  );
}

function ModelRows({ tiles }: { tiles: LibraryModelTile[] }) {
  if (tiles.length === 0) return <EmptyState message="No models available to you yet." />;

  return (
    <DenList>
      {tiles.map((tile) => (
        <DenListRow
          key={tile.key}
          leading={(
            <DenBrandMark
              name={tile.label}
              iconUrl={tile.iconUrl}
              simpleIconSlug={tile.simpleIconSlug}
              serviceUrl={tile.serviceUrl}
              className="h-10 w-10 rounded-[12px] border border-gray-100 bg-white"
            />
          )}
          title={tile.label}
          chips={<DenChip tone="success">Ready to use</DenChip>}
          meta={tile.providerName}
          dataAttributes={{ "data-library-model-key": tile.key }}
        />
      ))}
    </DenList>
  );
}

export function LibraryDetailsScreen() {
  const { orgId } = useOrgDashboard();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = parseTab(searchParams.get("tab"));

  const { data: items = [] } = useLibrary();
  const { data: skills = [], isLoading: skillsLoading, error: skillsError } = useLibrarySkills();
  const { tiles: modelTiles, isLoading: modelsLoading, error: modelsError } = useLibraryModels(orgId);

  const counts = useMemo(() => ({
    overview: items.length,
    connections: items.filter((item) => item.type === "connection").length,
    models: modelTiles.length,
    skills: skills.length,
    plugins: items.filter((item) => item.type === "plugin").length,
  }), [items, modelTiles.length, skills.length]);

  const tabs: TabItem<LibraryDetailsTab>[] = [
    { value: "overview", label: "Overview", count: counts.overview },
    { value: "connections", label: "Connections", count: counts.connections },
    { value: "models", label: "Models", count: counts.models },
    { value: "skills", label: "Skills", count: counts.skills },
    { value: "plugins", label: "Plugins", count: counts.plugins },
  ];

  // Tabs stay URL-addressable so the overview cards can deep-link into them.
  const selectTab = (tab: LibraryDetailsTab) => {
    router.replace(tab === "overview" ? pathname : `${pathname}?tab=${encodeURIComponent(tab)}`);
  };

  return (
    <DashboardPageTemplate
      icon={LibraryBig}
      badgeLabel="Member library"
      title="Library"
      description="Everything you can use in chat — yours, shared with you, from your teams, and org-wide."
      colors={["#DBEAFE", "#1E3A8A", "#2563EB", "#A7F3D0"]}
    >
      <div className="mb-6 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <UnderlineTabs
          className="min-w-max [&>nav]:flex-nowrap"
          tabs={tabs}
          activeTab={activeTab}
          onChange={selectTab}
          showZeroCounts
          ariaLabel="Library sections"
        />
      </div>

      {activeTab === "overview" ? <LibraryOverviewCards /> : null}
      {activeTab === "connections" ? <LibraryScreen embedded scope="connections" /> : null}
      {activeTab === "plugins" ? <LibraryScreen embedded scope="plugins" /> : null}

      {activeTab === "models" ? (
        modelsError ? (
          <DenNotice tone="error" message={modelsError} />
        ) : modelsLoading ? (
          <p className="text-[13px] text-gray-500">Loading your models…</p>
        ) : <ModelRows tiles={modelTiles} />
      ) : null}

      {activeTab === "skills" ? (
        skillsError ? (
          <DenNotice
            tone="error"
            message={skillsError instanceof Error ? skillsError.message : "Failed to load skills."}
          />
        ) : skillsLoading ? (
          <p className="text-[13px] text-gray-500">Loading your skills…</p>
        ) : skills.length === 0 ? (
          <EmptyState message="No skills shared with you yet." />
        ) : (
          <DenList>
            {skills.map((skill) => (
              <DenListRow
                key={skill.id}
                leading={<DenBrandMark name={skill.title} className="h-10 w-10 rounded-[12px] border border-gray-100 bg-white" />}
                title={skill.title}
                meta={skill.description}
                dataAttributes={{ "data-library-skill-key": `skill-${skill.id}` }}
              />
            ))}
          </DenList>
        )
      ) : null}
    </DashboardPageTemplate>
  );
}
