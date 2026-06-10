"use client";

import Link from "next/link";
import { Cable, Store } from "lucide-react";
import { getMarketplaceSourcesRoute, getMarketplacesRoute } from "../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

export type MarketplaceAreaTab = "marketplaces" | "sources";

const TABS = [
  { value: "marketplaces", label: "Marketplaces", icon: Store, getHref: getMarketplacesRoute },
  { value: "sources", label: "Sources", icon: Cable, getHref: getMarketplaceSourcesRoute },
] as const;

export function MarketplaceAreaTabs({ active }: { active: MarketplaceAreaTab }) {
  const { orgSlug } = useOrgDashboard();

  return (
    <div className="mb-6 border-b border-gray-200">
      <nav className="-mb-px flex flex-wrap gap-6" role="tablist">
        {TABS.map(({ value, label, icon: Icon, getHref }) => {
          const selected = active === value;
          return (
            <Link
              key={value}
              href={getHref(orgSlug)}
              role="tab"
              aria-selected={selected}
              className={`inline-flex items-center gap-2 border-b-2 pb-3 text-[14px] font-medium transition-colors ${
                selected
                  ? "border-[#0f172a] text-[#0f172a]"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
