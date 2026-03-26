"use client";

import Link from "next/link";
import { OPENWORK_DOCS_URL } from "./shared-setup-data";

const UPCOMING_BENEFITS = [
  "Standardize provider access across your team.",
  "Keep model choices consistent across shared setups.",
  "Control rollout without reconfiguring every teammate by hand.",
];

export function CustomLlmProvidersScreen() {
  return (
    <section className="den-page flex max-w-6xl flex-col gap-6 py-4 md:py-8">
      <div className="den-frame grid gap-6 p-6 md:p-8 lg:p-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3">
            <div className="flex items-center gap-3">
              <p className="den-eyebrow">OpenWork Cloud</p>
              <span className="den-status-pill is-neutral">Coming soon</span>
            </div>
            <h1 className="den-title-xl max-w-[12ch]">Custom LLM providers</h1>
            <p className="den-copy max-w-2xl">
              Standardize provider access for your team.
            </p>
          </div>

          <a href={OPENWORK_DOCS_URL} target="_blank" rel="noreferrer" className="den-button-secondary">
            Learn more
          </a>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {UPCOMING_BENEFITS.map((benefit) => (
            <div key={benefit} className="den-stat-card">
              <p className="den-stat-label">Coming soon</p>
              <p className="den-stat-copy mt-3">{benefit}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="den-frame-soft grid gap-4 p-5 md:p-6">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--dls-text-primary)]">What to expect</h2>
        <p className="den-copy text-sm">
          This page stays intentionally light for now. The goal is to make provider access easier to manage across shared setups once the feature is ready.
        </p>
        <div>
          <Link href="/checkout" className="den-button-secondary">
            Review billing
          </Link>
        </div>
      </div>
    </section>
  );
}
