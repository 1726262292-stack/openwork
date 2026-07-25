"use client";

import { Cloud } from "lucide-react";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";

export function CloudScreen() {
  return (
    <DashboardPageTemplate
      icon={Cloud}
      badgeLabel="Alpha"
      title="Cloud"
      description="OpenWork Cloud is enabled for this workspace. The full browser instance experience lands next."
      colors={["#EFF6FF", "#0F172A", "#2563EB", "#BAE6FD"]}
    >
      <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-[0_18px_45px_-35px_rgba(15,23,42,0.35)]">
        <p className="text-[15px] font-medium text-gray-950">Cloud is ready for this organization.</p>
        <p className="mt-2 text-[13px] leading-6 text-gray-500">
          The launch flow for a full OpenWork instance will appear here in the next alpha milestone.
        </p>
      </section>
    </DashboardPageTemplate>
  );
}
