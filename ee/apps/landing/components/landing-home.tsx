"use client";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { ArrowRight, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { LandingAppDemoPanel } from "./landing-app-demo-panel";
import { LandingBackground } from "./landing-background";
import { LandingCloudSection } from "./landing-cloud-section";
import { LandingCoworkerSection } from "./landing-coworker-section";
import { LandingCloudWorkersCard } from "./landing-cloud-workers-card";
import {
  defaultLandingDemoFlowId,
  landingDemoFlows,
  landingDemoFlowTimes
} from "./landing-demo-flows";
import { LandingFaq } from "./landing-faq";
import { LandingSharePackageCard } from "./landing-share-package-card";
import { SiteFooter } from "./site-footer";
import { SiteNav } from "./site-nav";
import { WaitlistForm } from "./waitlist-form";

type Props = {
  stars: string;
  downloadHref: string;
  callHref: string;
  isMobileVisitor: boolean;
};

const externalLinkProps = (href: string) =>
  /^https?:\/\//.test(href)
    ? { rel: "noreferrer", target: "_blank" as const }
    : {};

const CLOUD_SIGNUP_URL = "https://app.openworklabs.com?mode=sign-up";
const DOWNLOAD_SNIPPET = "open https://openworklabs.com/download";

const proofLogos = [
  { name: "Toyota", users: "4", src: "https://logo.clearbit.com/toyota.com" },
  { name: "Lenovo", users: "4", src: "https://logo.clearbit.com/lenovo.com" },
  { name: "IBM", users: "3", src: "https://logo.clearbit.com/ibm.com" },
  { name: "Tesla", users: "2", src: "https://logo.clearbit.com/tesla.com" },
  { name: "Stanford", users: "2", src: "https://logo.clearbit.com/stanford.edu" },
  { name: "MIT", users: "1", src: "https://logo.clearbit.com/mit.edu" }
];

const comparisonRows = [
  {
    feature: "Source model",
    openwork: "Open source desktop app",
    claude: "Closed Anthropic product"
  },
  {
    feature: "Model choice",
    openwork: "50+ LLM providers, including local models",
    claude: "Claude only"
  },
  {
    feature: "Files and workspace",
    openwork: "Local-first. Your files stay on your machine by default.",
    claude: "Hosted workspace flow"
  },
  {
    feature: "Team sharing",
    openwork: "Package skills, MCPs, plugins, and configs into one link",
    claude: "Built around Anthropic's managed experience"
  },
  {
    feature: "Deployment control",
    openwork: "Desktop, Cloud, or enterprise/self-hosted paths",
    claude: "Anthropic-hosted"
  }
];

export function LandingHome(props: Props) {
  const [activeDemoId, setActiveDemoId] = useState(defaultLandingDemoFlowId);
  const [activeUseCase, setActiveUseCase] = useState(0);
  const enterpriseShowcaseRef = useRef<HTMLElement>(null);
  const showEnterpriseShowcase = useInView(enterpriseShowcaseRef, {
    once: true,
    margin: "-15% 0px"
  });

  const activeDemo = useMemo(
    () => landingDemoFlows.find((flow) => flow.id === activeDemoId) ?? landingDemoFlows[0],
    [activeDemoId]
  );

  const callLinkProps = externalLinkProps(props.callHref);
  const primaryCtaHref = props.downloadHref;
  const primaryCtaLabel = "Download free — no sign-in";
  const primaryCtaLinkProps = externalLinkProps(primaryCtaHref);

  return (
    <div className="relative min-h-screen overflow-hidden text-[#011627]">
      <LandingBackground />

      <div className="relative z-10 flex min-h-screen flex-col items-center pb-3 pt-1 md:pb-4 md:pt-2">
        <div className="w-full">
          <SiteNav
            stars={props.stars}
            downloadHref={props.downloadHref}
            callUrl={props.callHref}
            mobilePrimaryHref={CLOUD_SIGNUP_URL}
            mobilePrimaryLabel="Get Started for free"
            active="home"
          />
        </div>

        <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 pb-24 md:gap-20 md:px-8 md:pb-28">
          <section className="max-w-4xl pt-8 md:pt-12">
            <h1 className="mb-5 text-4xl font-medium leading-[1.1] tracking-tight md:text-5xl lg:text-6xl">
              Run AI agents on
              <br />
              your own files —
              <br />
              <span className="font-pixel inline-block align-middle text-[1.05em] font-normal">
                open source.
              </span>
            </h1>
            <p className="mb-6 max-w-4xl text-lg leading-relaxed text-gray-700 md:mb-7 md:text-xl">
              OpenWork is the free desktop app that runs 50+ LLM providers with
              your own keys, keeps your files local by default, and lets your
              whole team share agent setups in one link.
            </p>

            <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <a
                  href={primaryCtaHref}
                  className="doc-button inline-flex items-center gap-2"
                  {...primaryCtaLinkProps}
                >
                  {primaryCtaLabel} <ArrowRight size={18} />
                </a>
                <a
                  href={props.callHref}
                  className="secondary-button"
                  {...callLinkProps}
                >
                  Contact sales
                </a>
              </div>

            </div>

            <div className="mt-5 flex w-full max-w-xl items-center gap-2 rounded-2xl border border-gray-200 bg-white/80 px-4 py-3 shadow-sm">
              <span className="text-[12px] font-medium uppercase tracking-[0.18em] text-gray-400">
                Try it
              </span>
              <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-[#011627]">
                {DOWNLOAD_SNIPPET}
              </code>
            </div>

            <div className="mt-6 grid max-w-3xl grid-cols-2 gap-3 text-left sm:grid-cols-4">
              {[
                { value: props.stars, label: "GitHub stars" },
                { value: "~200k", label: "downloads" },
                { value: "50+", label: "LLM providers" },
                { value: "YC", label: "backed" }
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-gray-100 bg-white/75 px-4 py-3 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.22)]"
                >
                  <div className="text-lg font-semibold tracking-tight text-[#011627]">
                    {stat.value}
                  </div>
                  <div className="text-[12px] text-gray-500">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 max-w-4xl">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                Used by people at teams and universities including
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {proofLogos.map((logo) => (
                  <div
                    key={logo.name}
                    className="flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white/75 px-3 py-3 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.22)]"
                    title={`${logo.users} OpenWork users at ${logo.name}`}
                  >
                    <img
                      src={logo.src}
                      alt={`${logo.name} logo`}
                      className="h-7 max-w-[100px] object-contain grayscale opacity-70 transition hover:grayscale-0 hover:opacity-100"
                      loading="lazy"
                    />
                    <div className="text-[11px] text-gray-400">
                      {logo.users} {logo.users === "1" ? "user" : "users"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {props.isMobileVisitor ? (
            <section
              id="mobile-signup"
              className="landing-shell-soft -mt-6 rounded-xl p-6 md:hidden"
            >
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-400">
                Mobile signup
              </div>
              <h2 className="mb-3 text-2xl font-medium leading-tight text-[#011627]">
                Start on mobile. Continue on desktop.
              </h2>
              <p className="mb-5 text-[15px] leading-7 text-gray-600">
                OpenWork is a desktop app. Sign up here from your phone and keep the
                desktop install flow handy for when you switch to your computer.
              </p>
              <WaitlistForm contactHref={props.callHref} />
              <p className="mt-4 text-[13px] leading-6 text-gray-500">
                Best path on mobile: landing, signup, then download on desktop.
              </p>
            </section>
          ) : null}

          <section className="relative flex flex-col gap-6 overflow-hidden md:gap-8">
            <div className="landing-shell relative flex flex-col overflow-hidden rounded-2xl">
              <div className="relative z-20 flex h-10 w-full shrink-0 items-center border-b border-white/50 bg-gradient-to-b from-white/90 to-white/60 px-4">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full border border-[#e0443e]/20 bg-[#ff5f56]/90 shadow-sm"></div>
                  <div className="h-3 w-3 rounded-full border border-[#dea123]/20 bg-[#ffbd2e]/90 shadow-sm"></div>
                  <div className="h-3 w-3 rounded-full border border-[#1aab29]/20 bg-[#27c93f]/90 shadow-sm"></div>
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 text-[12px] font-medium tracking-wide text-gray-500">
                  OpenWork
                </div>
              </div>
 
              <div className="bg-white p-4 md:p-6">
                <LandingAppDemoPanel
                  flows={landingDemoFlows}
                  activeFlowId={activeDemo.id}
                  onSelectFlow={setActiveDemoId}
                  timesById={landingDemoFlowTimes}
                />
              </div>

              <div className="relative z-10 mb-4 flex w-full flex-col items-start justify-between gap-4 px-2 md:flex-row md:items-center">
                <div className="landing-chip flex w-full flex-wrap gap-2 overflow-x-auto rounded-full p-1.5 md:w-[600px]">
                  {landingDemoFlows.map((flow) => {
                    const isActive = flow.id === activeDemo.id;

                    return (
                      <button
                        key={flow.id}
                        type="button"
                        onClick={() => setActiveDemoId(flow.id)}
                        aria-pressed={isActive}
                        className={`relative cursor-pointer whitespace-nowrap rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "text-[#011627]"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        {isActive ? (
                          <motion.div
                            layoutId="active-pill"
                            className="absolute inset-0 rounded-full border border-gray-100 bg-white shadow-sm"
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                          />
                        ) : null}
                        <span className="relative z-10">{flow.categoryLabel}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="min-h-[44px] text-left md:text-right">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeDemo.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="text-lg font-medium text-[#011627]">
                        {activeDemo.title}
                      </div>
                      <div className="ml-auto mt-1 max-w-md text-sm text-gray-500">
                        {activeDemo.description}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </section>

          <section className="landing-shell rounded-[2.5rem] p-8 md:p-12">
            <div className="mb-10 max-w-2xl">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                OpenWork vs Claude Cowork
              </div>
              <h2 className="mb-4 text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl">
                Built for teams that want control, not another locked-down AI workspace.
              </h2>
              <p className="text-lg leading-relaxed text-gray-700">
                Claude Cowork is a managed Anthropic experience. OpenWork is an
                open-source desktop app for teams that want local files, model
                choice, BYO keys, and shareable agent setups.
              </p>
            </div>

            <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white">
              <div className="grid grid-cols-[1.15fr_1fr_1fr] border-b border-gray-100 bg-gray-50/70 px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400 md:px-6">
                <div>Capability</div>
                <div>OpenWork</div>
                <div>Claude Cowork</div>
              </div>
              {comparisonRows.map((row) => (
                <div
                  key={row.feature}
                  className="grid grid-cols-1 gap-3 border-b border-gray-100 px-4 py-4 last:border-b-0 md:grid-cols-[1.15fr_1fr_1fr] md:gap-6 md:px-6"
                >
                  <div className="text-sm font-medium text-[#011627]">
                    {row.feature}
                  </div>
                  <div className="text-sm leading-relaxed text-gray-700">
                    <span className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-semibold text-emerald-700">
                      ✓
                    </span>
                    {row.openwork}
                  </div>
                  <div className="text-sm leading-relaxed text-gray-500">
                    {row.claude}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <a
                href={primaryCtaHref}
                className="doc-button inline-flex items-center gap-2"
                {...primaryCtaLinkProps}
              >
                Download OpenWork <ArrowRight size={18} />
              </a>
              <a href="/enterprise" className="secondary-button">
                See enterprise options
              </a>
            </div>
          </section>

          <section
            ref={enterpriseShowcaseRef}
            className="landing-shell rounded-[2.5rem] p-8 md:p-12"
          >
            <div className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              <Users size={18} />
              For Teams &amp; Enterprises
            </div>
            <h2 className="mb-16 max-w-2xl text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl lg:text-5xl">
              Build skills, workflows, connections once.<br />Share a link. Your team runs it instantly.
            </h2>

            <div className="flex flex-col gap-12 lg:flex-row lg:gap-20">
              <div className="flex w-full flex-col gap-10 lg:w-1/3">
                <button
                  type="button"
                  className={`text-left transition-opacity ${
                    activeUseCase === 0
                      ? "opacity-100"
                      : "opacity-50 hover:opacity-100"
                  }`}
                  onClick={() => setActiveUseCase(0)}
                >
                  <h3 className={`mb-2 text-xl font-medium ${
                    activeUseCase === 0 ? "text-[#011627]" : "text-gray-800"
                  }`}>
                    Share everything in one link.
                  </h3>
                  <p className={`text-sm leading-relaxed ${
                    activeUseCase === 0 ? "text-[#011627]" : "text-gray-600"
                  }`}>
                    Create skills, MCPs, plugins, and configs on your desktop.
                    Generate a single link that packages your entire setup for
                    your team.
                  </p>
                </button>

                <button
                  type="button"
                  className={`text-left transition-opacity ${
                    activeUseCase === 1
                      ? "opacity-100"
                      : "opacity-50 hover:opacity-100"
                  }`}
                  onClick={() => setActiveUseCase(1)}
                >
                  <h3 className={`mb-2 text-xl font-medium ${
                    activeUseCase === 1 ? "text-[#011627]" : "text-gray-800"
                  }`}>
                    Import in one click.
                  </h3>
                  <p className={`text-sm leading-relaxed ${
                    activeUseCase === 1 ? "text-[#011627]" : "text-gray-600"
                  }`}>
                    Your teammate opens the link and imports everything. Skills,
                    MCPs, plugins, configs. No terminal, no setup guide, no
                    technical knowledge needed.
                  </p>
                </button>

                <button
                  type="button"
                  className={`text-left transition-opacity ${
                    activeUseCase === 2
                      ? "opacity-100"
                      : "opacity-50 hover:opacity-100"
                  }`}
                  onClick={() => setActiveUseCase(2)}
                >
                  <h3 className={`mb-2 text-xl font-medium ${
                    activeUseCase === 2 ? "text-[#011627]" : "text-gray-800"
                  }`}>
                    Ready to run.
                  </h3>
                  <p className={`text-sm leading-relaxed ${
                    activeUseCase === 2 ? "text-[#011627]" : "text-gray-600"
                  }`}>
                    Everything imported. Skills already executing.
                  </p>
                </button>
              </div>

              <div
                className="relative flex min-h-[400px] w-full items-center justify-center overflow-hidden rounded-3xl border border-gray-100 bg-cover bg-center p-6 lg:w-2/3 md:p-10"
                style={{ backgroundImage: "url('/enterprise-showcase-bg.jpg')" }}
              >
                {showEnterpriseShowcase ? (
                  <div className="grid w-full [&>*]:col-start-1 [&>*]:row-start-1">
                    <motion.div
                      animate={{ opacity: activeUseCase === 0 ? 1 : 0 }}
                      transition={{ duration: 0.2 }}
                      className={`z-10 flex w-full justify-center ${activeUseCase !== 0 ? "pointer-events-none" : ""}`}
                    >
                      <LandingSharePackageCard />
                    </motion.div>
                    <motion.div
                      animate={{ opacity: activeUseCase === 1 ? 1 : 0 }}
                      transition={{ duration: 0.2 }}
                      className={`z-10 flex w-full justify-center ${activeUseCase !== 1 ? "pointer-events-none" : ""}`}
                    >
                      <LandingCloudWorkersCard />
                    </motion.div>
                    <motion.div
                      animate={{ opacity: activeUseCase === 2 ? 1 : 0 }}
                      transition={{ duration: 0.2 }}
                      className={`z-10 flex w-full justify-center ${activeUseCase !== 2 ? "pointer-events-none" : ""}`}
                    >
                        <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                          {/* App chrome */}
                          <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/80 px-4 py-2.5">
                            <div className="flex gap-1.5">
                              <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
                              <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
                              <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
                            </div>
                            <div className="text-[12px] font-medium text-gray-500">OpenWork</div>
                          </div>

                          <div className="flex flex-1">
                            {/* Sidebar */}
                            <div className="hidden w-[180px] flex-col border-r border-gray-100 bg-gray-50/50 p-3 sm:flex">
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between rounded-2xl bg-white px-2.5 py-2">
                                  <div className="flex items-center gap-2">
                                    <span className="h-6 w-6 rounded-full bg-gradient-to-br from-amber-400 to-orange-400" />
                                    <span className="text-[11px] font-medium text-[#011627]">Meeting Brief</span>
                                  </div>
                                  <span className="text-[9px] text-green-600">Active</span>
                                </div>
                                <div className="flex items-center justify-between rounded-lg px-2.5 py-2">
                                  <div className="flex items-center gap-2">
                                    <span className="h-6 w-6 rounded-full bg-gradient-to-br from-amber-400 to-orange-400" />
                                    <span className="text-[11px] font-medium text-gray-600">Contract Reviewer</span>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between rounded-lg px-2.5 py-2">
                                  <div className="flex items-center gap-2">
                                    <span className="h-6 w-6 rounded-full bg-gradient-to-br from-amber-400 to-orange-400" />
                                    <span className="text-[11px] font-medium text-gray-600">Outreach CRM</span>
                                  </div>
                                </div>
                              </div>

                              <div className="mt-4 flex flex-col gap-1 border-t border-gray-100 pt-3">
                                <div className="truncate rounded-2xl bg-white px-2.5 py-1.5 text-[10px] text-gray-500">
                                  Generate brief for Acme...
                                  <span className="ml-1 text-gray-400">1s ago</span>
                                </div>
                                <div className="truncate px-2.5 py-1.5 text-[10px] text-gray-400">
                                  Review NDA draft...
                                  <span className="ml-1">12m ago</span>
                                </div>
                              </div>
                            </div>

                            {/* Main content - chat */}
                            <div className="flex flex-1 flex-col">
                              <div className="flex flex-1 flex-col gap-4 p-4">
                                {/* User prompt */}
                                <div className="self-end rounded-2xl rounded-br-md bg-gray-100 px-4 py-2.5 text-[12px] leading-relaxed text-[#011627]">
                                  Prepare a meeting brief for tomorrow&apos;s call with Acme Corp. Pull context from HubSpot and Notion.
                                </div>

                                {/* Execution timeline */}
                                <div className="flex flex-col gap-1 pl-1">
                                  <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                    <span className="text-gray-300">&rsaquo;</span> Execution 1 step — Queried HubSpot MCP for deal history
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                    <span className="text-gray-300">&rsaquo;</span> Execution 2 steps — Pulled Notion meeting notes
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                    <span className="text-gray-300">&rsaquo;</span> Execution 1 step — Generated brief and saved to desktop
                                  </div>
                                </div>

                                {/* Response */}
                                <div className="text-[12px] leading-relaxed text-[#011627]">
                                  I&apos;ve prepared your meeting brief for the Acme Corp call. It includes deal history, recent notes, and 3 talking points.
                                </div>
                              </div>

                              {/* Input bar */}
                              <div className="border-t border-gray-100 p-3">
                                <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
                                  <span className="text-[12px] text-gray-400">Describe your task</span>
                                  <span className="rounded-full bg-[#011627] px-3 py-1 text-[10px] font-medium text-white">Run Task</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                    </motion.div>
                  </div>
                ) : (
                  <div className="z-10 flex w-full justify-center">
                    <div className="landing-shell h-[320px] w-full max-w-lg rounded-xl border border-dashed border-gray-200" />
                  </div>
                )}
              </div>
            </div>
          </section>

          <LandingCloudSection />

          <LandingCoworkerSection />

          <LandingFaq />

          <section className="landing-shell rounded-[2.5rem] p-8 text-center md:p-12">
            <h2 className="mx-auto mb-4 max-w-2xl text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl">
              Start free. Upgrade when your team&apos;s ready.
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-gray-700">
              Run OpenWork locally for free, or spin up a shared cloud workspace
              in minutes. No credit card to start.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={primaryCtaHref}
                className="doc-button inline-flex items-center gap-2"
                {...primaryCtaLinkProps}
              >
                {primaryCtaLabel} <ArrowRight size={18} />
              </a>
              <a
                href={props.callHref}
                className="secondary-button"
                {...callLinkProps}
              >
                Contact sales
              </a>
            </div>
          </section>

          <SiteFooter />
        </div>
      </div>
    </div>
  );
}
