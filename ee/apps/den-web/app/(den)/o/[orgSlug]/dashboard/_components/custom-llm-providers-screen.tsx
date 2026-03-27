"use client";

import Link from "next/link";
import { Cpu } from "lucide-react";
import { getBillingRoute } from "../../../../_lib/den-org";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { OPENWORK_DOCS_URL } from "./shared-setup-data";

const UPCOMING_BENEFITS = [
  "Standardize provider access across your team.",
  "Keep model choices consistent across shared setups.",
  "Control rollout without reconfiguring every teammate by hand.",
];

export function CustomLlmProvidersScreen() {
  const { orgSlug } = useOrgDashboard();

  return (
    <div className="mx-auto max-w-[980px] px-6 py-8 md:px-8">
      <div className="relative mb-8 flex h-[220px] items-center overflow-hidden rounded-[28px] border border-gray-100 px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(224,252,255,0.95),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(80,247,212,0.55),transparent_22%),radial-gradient(circle_at_70%_80%,rgba(81,142,240,0.6),transparent_28%),linear-gradient(135deg,#1c2a30_0%,#1d7b9a_45%,#223140_100%)]" />
        <div className="relative z-10 flex flex-col items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/30 bg-white/20 backdrop-blur-md">
            <Cpu className="h-6 w-6 text-white" strokeWidth={1.5} />
          </div>
          <div>
            <span className="mb-2 inline-block rounded-full border border-white/20 bg-white/20 px-2.5 py-1 text-[10px] uppercase tracking-[1px] text-white backdrop-blur-md">
              Coming soon
            </span>
            <h1 className="text-[28px] font-medium tracking-[-0.5px] text-white">
              Custom LLMs
            </h1>
          </div>
        </div>
      </div>

      <p className="mb-6 text-[14px] text-gray-500">
        Standardize provider access for your team.
      </p>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {UPCOMING_BENEFITS.map((benefit) => (
          <div
            key={benefit}
            className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-6"
          >
            <span className="inline-block self-start rounded-full border border-gray-100 bg-gray-50 px-2 py-0.5 text-[10px] uppercase tracking-[1px] text-gray-500">
              Coming soon
            </span>
            <p className="text-[13px] leading-[1.6] text-gray-600">{benefit}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href={OPENWORK_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Learn more
        </a>
        <Link
          href={getBillingRoute(orgSlug)}
          className="rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Review billing
        </Link>
      </div>
    </div>
  );
}
