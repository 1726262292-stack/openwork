"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Globe2, Monitor, SquareTerminal } from "lucide-react";
import { useMemo, useState } from "react";

import { BrandLogo } from "./lp-brand-logos";
import { LandingAppDemoPanel } from "./landing-app-demo-panel";
import { LandingBackground } from "./landing-background";
import {
  defaultLandingDemoFlowId,
  landingDemoFlows,
  landingDemoFlowTimes
} from "./landing-demo-flows";
import { LandingFaq } from "./landing-faq";
import { LandingHeroPrompt } from "./landing-hero-prompt";
import { LpCopyBar } from "./lp-copy-bar";
import { LpCta } from "./lp-cta";
import { LpGatewayDiagram } from "./lp-gateway-diagram";
import { LpParityTable } from "./lp-parity-table";
import {
  LpAlphaBadge,
  LpArrowLink,
  LpSectionHeader,
  LpTickBlock,
  LpTonalCard
} from "./lp-primitives";
import { SiteFooter } from "./site-footer";
import { SiteNav } from "./site-nav";

type Props = {
  stars: string;
  downloadHref: string;
  callHref: string;
  isMobileVisitor: boolean;
};

type DemoSurface = "desktop" | "web" | "connect";

const CLOUD_SIGNUP_URL = "https://app.openworklabs.com?mode=sign-up";
const GATEWAY_URL = "https://api.openworklabs.com/mcp/agent";

const demoSurfaces: {
  id: DemoSurface;
  label: string;
  alpha?: boolean;
}[] = [
  { id: "desktop", label: "Desktop" },
  { id: "web", label: "OpenWork Web", alpha: true },
  { id: "connect", label: "Connect — MCP Gateway" }
];

type ProviderLogoName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "aws"
  | "openrouter"
  | "mistral";

const providers: { label: string; logo?: ProviderLogoName }[] = [
  { label: "OpenAI", logo: "openai" },
  { label: "Anthropic", logo: "anthropic" },
  { label: "Gemini", logo: "gemini" },
  { label: "Bedrock", logo: "aws" },
  { label: "Azure AI Foundry" },
  { label: "OpenRouter", logo: "openrouter" },
  { label: "Mistral", logo: "mistral" }
];

type TaskToggleProps = {
  enabled: boolean;
  onToggle: () => void;
  label: string;
};

function TaskToggle({ enabled, onToggle, label }: TaskToggleProps) {
  const reduceMotion = useReducedMotion();

  return (
    <button
      type="button"
      aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}
      aria-pressed={enabled}
      onClick={onToggle}
      className={`lp-toggle-track relative h-5 w-[34px] shrink-0 rounded-full transition-colors duration-200 ${
        enabled ? "bg-[var(--lp-ink)]" : "bg-[#cbd5e1]"
      }`}
    >
      <motion.span
        animate={{ x: enabled ? 15 : 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.15, ease: "easeOut" }}
        className="lp-toggle-knob absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white"
      />
    </button>
  );
}

function ScheduledTasksCard() {
  const [standup, setStandup] = useState(true);
  const [cleanup, setCleanup] = useState(true);
  const [invoice, setInvoice] = useState(false);

  const tasks = [
    {
      title: "Daily standup digest",
      schedule: "Every weekday · 9:00 AM · posts to Slack",
      enabled: standup,
      toggle: () => setStandup((value) => !value)
    },
    {
      title: "Weekly CRM cleanup",
      schedule: "Fridays · 5:00 PM · HubSpot MCP",
      enabled: cleanup,
      toggle: () => setCleanup((value) => !value)
    },
    {
      title: "Invoice chaser",
      schedule: "1st of the month · drafts follow-up emails",
      enabled: invoice,
      toggle: () => setInvoice((value) => !value)
    }
  ];

  return (
    <LpTonalCard className="flex min-h-[520px] flex-col justify-between p-7">
      <div className="flex flex-col gap-3">
        {tasks.map((task) => (
          <div
            key={task.title}
            className="flex items-center justify-between gap-4 rounded-[12px] bg-white px-4 py-3.5"
          >
            <div>
              <div className="text-[14px] font-medium text-[var(--lp-ink)]">
                {task.title}
              </div>
              <div className="mt-1 text-[12px] text-[var(--lp-muted)]">
                {task.schedule}
              </div>
            </div>
            <TaskToggle
              enabled={task.enabled}
              onToggle={task.toggle}
              label={task.title}
            />
          </div>
        ))}
      </div>
      <div>
        <div className="flex items-center gap-2 text-[14px] text-[var(--lp-muted)]">
          Scheduled tasks <LpAlphaBadge />
        </div>
        <p className="mt-2 max-w-[430px] text-[16px] leading-6 text-[var(--lp-ink)]">
          Run any prompt on a schedule or trigger. Set it once and let it handle
          itself.
        </p>
      </div>
    </LpTonalCard>
  );
}

function DemoPlaceholder({ surface }: { surface: Exclude<DemoSurface, "desktop"> }) {
  const isWeb = surface === "web";

  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-[18px] bg-white px-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--lp-tonal)]">
          {isWeb ? (
            <Globe2 className="h-5 w-5" strokeWidth={1.6} />
          ) : (
            <SquareTerminal className="h-5 w-5" strokeWidth={1.6} />
          )}
        </div>
        <div className="mt-5 flex items-center justify-center gap-2 text-[18px] font-medium text-[var(--lp-ink)]">
          {isWeb ? "OpenWork Web" : "OpenWork Connect"}
          {isWeb ? <LpAlphaBadge /> : null}
        </div>
        <p className="mt-2 text-[14px] leading-[22px] text-[var(--lp-muted)]">
          {isWeb
            ? "The same workspace in your browser — same skills, tasks, and team setup."
            : "One MCP gateway URL gives every client your org’s skills, servers, roles, and policies."}
        </p>
      </div>
    </div>
  );
}

export function LandingHome(props: Props) {
  const [activeDemoId, setActiveDemoId] = useState(defaultLandingDemoFlowId);
  const [activeSurface, setActiveSurface] = useState<DemoSurface>("desktop");
  const reduceMotion = useReducedMotion();
  const activeDemo = useMemo(
    () => landingDemoFlows.find((flow) => flow.id === activeDemoId) ?? landingDemoFlows[0],
    [activeDemoId]
  );
  const primaryHref = props.isMobileVisitor ? CLOUD_SIGNUP_URL : props.downloadHref;
  const primaryExternal = /^https?:\/\//.test(primaryHref);
  const callExternal = /^https?:\/\//.test(props.callHref);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[var(--lp-page)] text-[var(--lp-ink)]">
      <LandingBackground />

      <div className="relative z-10">
        <SiteNav
          stars={props.stars}
          downloadHref={props.downloadHref}
          callUrl={props.callHref}
          mobilePrimaryHref={CLOUD_SIGNUP_URL}
          mobilePrimaryLabel="Get started for free"
          active="home"
        />

        <main className="mx-auto w-full max-w-[1176px] px-6 pb-8">
          <section className="pt-16 md:pt-[88px]">
            <div className="flex flex-col justify-between gap-10 lg:flex-row lg:items-end">
              <h1 className="max-w-[640px] text-[46px] font-light leading-[51px] tracking-[-0.02em] md:text-[58px] md:leading-[62px]">
                <motion.span
                  className="block"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.4 }}
                >
                  The open source
                </motion.span>
                <motion.span
                  className="block"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.4, delay: reduceMotion ? 0 : 0.08 }}
                >
                  Claude Cowork
                </motion.span>
                <motion.span
                  className="font-pixel block font-normal"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.4, delay: reduceMotion ? 0 : 0.16 }}
                >
                  alternative.
                </motion.span>
              </h1>

              <div className="max-w-[440px] pb-1">
                <p className="text-[16px] leading-[25px] text-[var(--lp-ink)]">
                  Everything your team uses Claude Cowork for — chat on your files,
                  skills, scheduled tasks, browser automation — on any model. Plus
                  an MCP gateway Cowork doesn&apos;t have.
                </p>
                <p className="mt-4 text-[14px] leading-[22px] text-[var(--lp-muted)]">
                  Free &amp; open source. Desktop for macOS, Windows, and Linux. Web
                  in alpha.
                </p>
              </div>
            </div>

            <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href={primaryHref}
                  className="lp-pill-primary"
                  target={primaryExternal ? "_blank" : undefined}
                  rel={primaryExternal ? "noreferrer" : undefined}
                >
                  Download for free
                </a>
                <a
                  href={props.callHref}
                  className="lp-pill-secondary"
                  target={callExternal ? "_blank" : undefined}
                  rel={callExternal ? "noreferrer" : undefined}
                >
                  Talk to sales
                </a>
              </div>
              <div className="flex items-center gap-2 text-[13.5px] text-[var(--lp-muted)] sm:ml-2">
                <span>Backed by</span>
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-[#fb651e] text-[11px] font-bold text-white">
                  Y
                </span>
                <span>Combinator</span>
              </div>
            </div>
          </section>

          <section className="mt-16 md:mt-20" aria-label="OpenWork product demo">
            <div className="rounded-[24px] bg-[rgba(240,244,249,0.75)] p-2">
              <div className="grid grid-cols-1 gap-1 p-1 sm:grid-cols-3">
                {demoSurfaces.map((surface) => {
                  const active = surface.id === activeSurface;

                  return (
                    <button
                      key={surface.id}
                      type="button"
                      onClick={() => setActiveSurface(surface.id)}
                      aria-pressed={active}
                      className={`relative flex h-12 items-center justify-center gap-2 rounded-[14px] px-3 text-[13px] transition-colors duration-150 ${
                        active
                          ? "text-[var(--lp-ink)]"
                          : "text-[var(--lp-muted)] hover:text-[var(--lp-ink)]"
                      }`}
                    >
                      {active ? (
                        <motion.span
                          layoutId="home-demo-surface"
                          className="absolute inset-0 rounded-[14px] bg-white shadow-[0_1px_3px_rgba(1,22,39,0.08)]"
                          transition={{ duration: reduceMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                        />
                      ) : null}
                      <span className="relative z-10 flex items-center gap-2">
                        {surface.id === "desktop" ? (
                          <span className="h-2 w-2 rounded-full bg-[var(--lp-status-dot)]" />
                        ) : null}
                        {surface.label}
                        {surface.alpha ? <LpAlphaBadge /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeSurface}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2 }}
                >
                  {activeSurface === "desktop" ? (
                    <div>
                      <div className="overflow-hidden rounded-[18px] bg-white p-4 md:p-6">
                        <LandingAppDemoPanel
                          flows={landingDemoFlows}
                          activeFlowId={activeDemo.id}
                          onSelectFlow={setActiveDemoId}
                          timesById={landingDemoFlowTimes}
                        />
                      </div>
                      <div className="flex flex-col justify-between gap-4 px-2 pb-3 pt-4 lg:flex-row lg:items-center">
                        <div className="flex flex-wrap gap-2">
                          {landingDemoFlows.map((flow) => {
                            const active = flow.id === activeDemo.id;
                            return (
                              <button
                                key={flow.id}
                                type="button"
                                onClick={() => setActiveDemoId(flow.id)}
                                className={`relative rounded-full px-4 py-2 text-[13px] transition-colors duration-150 ${
                                  active
                                    ? "bg-white text-[var(--lp-ink)]"
                                    : "text-[var(--lp-muted)] hover:text-[var(--lp-ink)]"
                                }`}
                              >
                                {flow.categoryLabel}
                              </button>
                            );
                          })}
                        </div>
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div
                            key={activeDemo.id}
                            initial={reduceMotion ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={reduceMotion ? undefined : { opacity: 0 }}
                            className="max-w-[420px] text-left lg:text-right"
                          >
                            <div className="text-[15px] font-medium text-[var(--lp-ink)]">
                              {activeDemo.title}
                            </div>
                            <div className="mt-1 text-[13px] leading-5 text-[var(--lp-muted)]">
                              {activeDemo.description}
                            </div>
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </div>
                  ) : (
                    <DemoPlaceholder surface={activeSurface} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </section>

          <section className="mt-[120px]">
            <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
              <h2 className="max-w-[680px] text-[16px] font-normal text-[var(--lp-ink)]">
                Bring any model — or provision centrally for your whole org
              </h2>
              <a href="/docs" className="lp-pill-secondary lp-pill-sm">
                See all 50+ providers
              </a>
            </div>
            <LpTickBlock>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
                {providers.map((provider, index) => (
                  <div
                    key={provider.label}
                    className={`group flex h-24 items-center justify-center gap-2.5 px-3 text-center text-[14.5px] font-medium text-[var(--lp-muted)] ${
                      index > 0 ? "border-l border-[var(--lp-border)]" : ""
                    }`}
                  >
                    {provider.logo ? (
                      <BrandLogo
                        name={provider.logo}
                        className="lp-logo h-[21px] w-[21px] shrink-0 opacity-60 transition-opacity duration-150 group-hover:opacity-100"
                      />
                    ) : null}
                    <span className="opacity-60 transition-opacity duration-150 group-hover:opacity-100">
                      {provider.label}
                    </span>
                  </div>
                ))}
              </div>
            </LpTickBlock>
          </section>

          <section className="mt-[120px]" id="comparison">
            <LpSectionHeader
              label="OpenWork vs Claude Cowork"
              heading="Feature parity. Zero lock-in."
              right={
                <a href="/docs" className="lp-pill-secondary lp-pill-sm">
                  See the migration guide
                </a>
              }
            />
            <p className="mt-6 max-w-[640px] text-[16px] leading-[25px] text-[var(--lp-body)]">
              If your team runs on Claude Cowork today, everything keeps working —
              and you stop being tied to one vendor, one model, and one deployment.
            </p>
            <div className="mt-10">
              <LpParityTable />
            </div>
          </section>

          <section className="mt-[120px]" id="product">
            <LpSectionHeader
              label="In the box"
              heading="Built for real work."
              right={
                <a href="#comparison" className="lp-pill-secondary lp-pill-sm">
                  Compare all features
                </a>
              }
            />

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <div
                className="flex min-h-[520px] flex-col justify-between rounded-[24px] bg-cover bg-center p-7"
                style={{ backgroundImage: "url('/enterprise-showcase-bg.jpg')" }}
              >
                <div className="flex flex-col gap-3">
                  <div className="ml-auto max-w-[390px] rounded-full bg-white/90 px-5 py-3 text-right text-[13px] leading-5 text-[var(--lp-ink)]">
                    Like all replies on this thread and export the users to CSV
                  </div>
                  <div className="max-w-[360px] rounded-[14px] bg-white/90 px-4 py-3 text-[13px] leading-5 text-[var(--lp-ink)]">
                    Opening the thread in Chrome — 42 replies loaded
                  </div>
                  <div className="flex max-w-[330px] items-center gap-2 rounded-[14px] bg-white/90 px-4 py-3 text-[13px] leading-5 text-[var(--lp-ink)]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[var(--lp-status)]" />
                    tweet_replies.csv saved to Desktop
                  </div>
                </div>
                <div>
                  <div className="text-[14px] text-[rgba(1,22,39,0.65)]">
                    Browser automation
                  </div>
                  <p className="mt-2 max-w-[430px] text-[16px] leading-6 text-[var(--lp-ink)]">
                    Agents click, scroll, extract, and fill forms in a real browser —
                    across the tools your team already uses.
                  </p>
                </div>
              </div>

              <ScheduledTasksCard />
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-3">
              <LpTonalCard className="group flex min-h-[260px] flex-col justify-between p-6">
                <div className="lp-icon-chip flex h-11 w-11 items-center justify-center rounded-full bg-white transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:rotate-[8deg]">
                  <BrandLogo name="github" className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-[14px] text-[var(--lp-muted)]">Import existing repos</div>
                  <p className="mt-2 text-[15.5px] leading-[23px] text-[var(--lp-ink)]">
                    Point OpenWork at any repository and start working with full
                    context.
                  </p>
                </div>
              </LpTonalCard>

              <LpTonalCard className="group flex min-h-[260px] flex-col justify-between p-6">
                <div className="lp-icon-chip flex h-11 w-11 items-center justify-center rounded-full bg-white transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:rotate-[8deg]">
                  <BrandLogo name="anthropic" className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-[14px] text-[var(--lp-muted)]">Anthropic plugins</div>
                  <p className="mt-2 text-[15.5px] leading-[23px] text-[var(--lp-ink)]">
                    Anthropic-compatible plugins and skills run as-is. No porting,
                    no wrappers.
                  </p>
                </div>
              </LpTonalCard>

              <LpTonalCard className="group flex min-h-[260px] flex-col justify-between p-6">
                <div className="lp-icon-chip flex h-11 w-11 items-center justify-center rounded-full bg-white transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:rotate-[8deg]">
                  <Globe2 className="h-5 w-5" strokeWidth={1.6} />
                </div>
                <div>
                  <div className="flex items-center gap-2 text-[14px] text-[var(--lp-muted)]">
                    OpenWork Web <LpAlphaBadge />
                  </div>
                  <p className="mt-2 text-[15.5px] leading-[23px] text-[var(--lp-ink)]">
                    The same workspace in your browser. Nothing to install.
                  </p>
                </div>
              </LpTonalCard>
            </div>
          </section>

          <section className="mt-[120px]">
            <LpSectionHeader
              label="OpenWork Connect"
              heading="Set up your MCPs once. Your whole team has them."
              headingLines={["Set up your MCPs once.", "Your whole team has them."]}
              right={
                <a href="/connect" className="lp-pill-secondary lp-pill-sm">
                  Explore OpenWork Connect
                </a>
              }
            />
            <p className="mt-6 max-w-[640px] text-[16px] leading-[25px] text-[var(--lp-body)]">
              OpenWork Connect is our MCP gateway. Add a server or skill to your org
              once — every teammate and agent gets it instantly, in OpenWork and in
              any MCP-compatible client. Claude Cowork has no equivalent.
            </p>
            <div className="mt-10">
              <LpGatewayDiagram />
            </div>
            <div className="mt-6">
              <LpCopyBar value={GATEWAY_URL} />
            </div>
            <p className="mt-3 text-[13.5px] text-[var(--lp-muted)]">
              One URL for your whole org — skills, MCPs, roles, and policies
              included. Works with your OpenWork account.
            </p>
          </section>

          <section className="mt-[120px]">
            <LpSectionHeader
              label="Get started"
              heading="Use it today — your way."
              right={
                <p className="max-w-[340px] text-left text-[14.5px] leading-[22px] text-[var(--lp-body)] md:text-right">
                  Three doors into the same workspace. Same skills, same gateway,
                  same account.
                </p>
              }
            />
            <div className="mt-10">
              <LpTickBlock>
                <div className="grid md:grid-cols-3">
                  <div className="group flex min-h-[330px] flex-col items-start p-8">
                    <Monitor className="lp-draw-icon h-[22px] w-[22px]" strokeWidth={1.6} />
                    <h3 className="mt-6 text-[17px] font-medium">On your desktop</h3>
                    <p className="mt-3 max-w-[280px] text-[14px] leading-[22px] text-[var(--lp-body)]">
                      Stable on macOS — Windows and Linux in alpha. Local-first, no
                      account needed.
                    </p>
                    <a
                      href={props.downloadHref}
                      className="lp-pill-primary lp-pill-sm mt-auto"
                    >
                      Download
                    </a>
                  </div>

                  <div className="group flex min-h-[330px] flex-col items-start border-t border-[var(--lp-border)] p-8 transition-colors duration-150 hover:border-[var(--lp-ink)] md:border-l md:border-t-0">
                    <Globe2 className="lp-draw-icon h-[22px] w-[22px]" strokeWidth={1.6} />
                    <h3 className="mt-6 flex items-center gap-2 text-[17px] font-medium">
                      In your browser <LpAlphaBadge />
                    </h3>
                    <p className="mt-3 max-w-[280px] text-[14px] leading-[22px] text-[var(--lp-body)]">
                      OpenWork Web. Nothing to install — sign in and run your first
                      task.
                    </p>
                    <a
                      href="https://app.openworklabs.com"
                      className="lp-pill-secondary lp-pill-sm mt-auto"
                    >
                      Open in browser
                    </a>
                  </div>

                  <div className="group flex min-h-[330px] flex-col items-start border-t border-[var(--lp-border)] p-8 transition-colors duration-150 hover:border-[var(--lp-ink)] md:border-l md:border-t-0">
                    <SquareTerminal className="lp-draw-icon h-[22px] w-[22px]" strokeWidth={1.6} />
                    <h3 className="mt-6 text-[17px] font-medium">From your agent</h3>
                    <p className="mt-3 max-w-[280px] text-[14px] leading-[22px] text-[var(--lp-body)]">
                      In Claude Code, Cursor, or Codex? One pasted prompt installs
                      and sets up OpenWork for you.
                    </p>
                    <LandingHeroPrompt className="mt-6 w-full" />
                  </div>
                </div>
              </LpTickBlock>
            </div>
          </section>

          <section className="mt-[120px]">
            <LpSectionHeader label="Where to next" heading="Take it to your team." />
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              <LpTonalCard className="flex min-h-[240px] flex-col justify-between p-6">
                <div className="text-[14px] text-[var(--lp-muted)]">For you</div>
                <div>
                  <h3 className="text-[19px] font-medium">Run it on your machine</h3>
                  <p className="mt-2 text-[14.5px] leading-[22px] text-[var(--lp-body)]">
                    The free desktop app. Your files, your keys, fully local-first.
                  </p>
                  <div className="mt-4">
                    <LpArrowLink href={primaryHref}>Download free</LpArrowLink>
                  </div>
                </div>
              </LpTonalCard>

              <LpTonalCard className="flex min-h-[240px] flex-col justify-between p-6">
                <div className="text-[14px] text-[var(--lp-muted)]">For teams</div>
                <div>
                  <h3 className="text-[19px] font-medium">Manage it centrally</h3>
                  <p className="mt-2 text-[14.5px] leading-[22px] text-[var(--lp-body)]">
                    Deploy skills, MCPs, and models to every seat with OpenWork
                    Cloud.
                  </p>
                  <div className="mt-4">
                    <LpArrowLink href="/cloud">Explore Cloud</LpArrowLink>
                  </div>
                </div>
              </LpTonalCard>

              <LpTonalCard className="flex min-h-[240px] flex-col justify-between p-6">
                <div className="text-[14px] text-[var(--lp-muted)]">For enterprises</div>
                <div>
                  <h3 className="text-[19px] font-medium">Own your AI stack</h3>
                  <p className="mt-2 text-[14.5px] leading-[22px] text-[var(--lp-body)]">
                    Self-sovereign AI — your models, your infrastructure. Managed or
                    self-hosted.
                  </p>
                  <div className="mt-4">
                    <LpArrowLink href="/enterprise">See Enterprise</LpArrowLink>
                  </div>
                </div>
              </LpTonalCard>
            </div>
          </section>

          <div className="mt-[120px]">
            <LandingFaq />
          </div>

          <div className="mt-[120px]">
            <LpCta
              heading="Give your whole team an agent."
              sub="Free on desktop. Central management in Cloud. Private instances for enterprise."
              primary={{ label: "Download for free →", href: primaryHref }}
              secondary={{ label: "Talk to sales", href: props.callHref }}
              trust="Free & open source · No account required to start"
            />
          </div>

          <div className="mt-[120px]">
            <SiteFooter />
          </div>
        </main>
      </div>
    </div>
  );
}
