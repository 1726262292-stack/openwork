"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Globe, Monitor, SquareTerminal } from "lucide-react";
import { useMemo, useState } from "react";

import { BrandLogo } from "./lp-brand-logos";
import { LandingAppDemoPanel } from "./landing-app-demo-panel";
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
import { LpHeroBackground } from "./lp-hero-background";
import { LpParityTable } from "./lp-parity-table";
import {
  LpAlphaBadge,
  LpArrowLink,
  LpSectionHeader,
  LpTonalCard
} from "./lp-primitives";
import { SiteFooter } from "./site-footer";
import { SiteNav } from "./site-nav";

type Props = {
  stars: string;
  downloadHref: string;
  windowsDownloadHref: string;
  linuxDownloadHref: string;
  callHref: string;
  isMobileVisitor: boolean;
};

const CLOUD_SIGNUP_URL = "https://app.openworklabs.com";
const GATEWAY_URL = "https://api.openworklabs.com/mcp/agent";

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

export function LandingHome(props: Props) {
  const [activeDemoId, setActiveDemoId] = useState(defaultLandingDemoFlowId);
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
      <LpHeroBackground />

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
                  OpenWork is the desktop app that lets you use 50+ LLMs, bring
                  your own keys, and share your setups seamlessly with your team.
                </p>
                <p className="mt-4 text-[14px] leading-[22px] text-[var(--lp-body)]">
                  Free &amp; open source.
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
                  Download for macOS
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

            <div className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[13.5px] text-[var(--lp-muted)]">
              <span>Also available:</span>
              <a
                href={props.windowsDownloadHref}
                className="text-[var(--lp-ink)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
              >
                Windows
              </a>
              <span>·</span>
              <a
                href={props.linuxDownloadHref}
                className="text-[var(--lp-ink)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
              >
                Linux
              </a>
            </div>

            <LandingHeroPrompt className="mt-12 max-w-[900px]" />
          </section>

          <section className="mt-16 md:mt-20" aria-label="OpenWork product demo">
            <div className="rounded-[24px] bg-[var(--lp-tonal)] p-2">
              <div className="relative flex h-11 items-center px-4">
                <div className="flex gap-1.5" aria-hidden="true">
                  <span className="h-3 w-3 rounded-full bg-[#fb7185]" />
                  <span className="h-3 w-3 rounded-full bg-[#fbbf24]" />
                  <span className="h-3 w-3 rounded-full bg-[#34d399]" />
                </div>
                <div className="absolute left-1/2 -translate-x-1/2 text-[12px] font-medium text-[var(--lp-muted)]">
                  OpenWork
                </div>
              </div>

              <div className="overflow-hidden rounded-[16px] bg-white p-4 md:p-6">
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
                            : "text-[var(--lp-body)] hover:text-[var(--lp-ink)]"
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
          </section>

          <section className="mt-[120px]">
            <div className="mb-8">
              <h2 className="max-w-[680px] text-[16px] font-normal text-[var(--lp-ink)]">
                Bring any model — or provision centrally for your whole org
              </h2>
            </div>
            <div className="rounded-[24px] bg-[var(--lp-tonal)] px-6 py-7 md:px-10">
              <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3 md:flex md:items-center md:justify-between md:gap-6">
                {providers.map((provider) => (
                  <div
                    key={provider.label}
                    className="group flex items-center gap-2.5 text-[14px] font-medium text-[var(--lp-muted)] opacity-70 transition-opacity duration-150 hover:opacity-100 md:shrink-0 md:text-[15px]"
                  >
                    {provider.logo ? (
                      <BrandLogo
                        name={provider.logo}
                        className="lp-logo h-[21px] w-[21px] shrink-0"
                      />
                    ) : null}
                    <span>{provider.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5">
              <LpArrowLink href="/docs">See all 50+ providers</LpArrowLink>
            </div>
          </section>

          <section className="mt-[120px]" id="comparison">
            <LpSectionHeader
              label="OpenWork vs Claude Cowork"
              heading="Feature parity. Zero lock-in."
              right={
                <a href="/docs/start-here/migrate-from-claude-cowork" className="lp-pill-secondary lp-pill-sm !hidden md:!inline-flex">
                  See the migration guide
                </a>
              }
            />
            <p className="mt-6 max-w-[640px] text-[16px] leading-[25px] text-[var(--lp-body)]">
              If your team runs on Claude Cowork today, everything keeps working —
              and you stop being tied to one vendor, one model, and one deployment.
            </p>
            <a
              href="/docs/start-here/migrate-from-claude-cowork"
              className="lp-pill-secondary lp-pill-sm mt-6 md:!hidden"
            >
              See the migration guide
            </a>
            <div className="mt-10">
              <LpParityTable />
            </div>
          </section>

          <section className="mt-[120px]" id="product">
            <div className="grid gap-6 md:grid-cols-3">
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
                  <Globe className="h-5 w-5" strokeWidth={1.75} />
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
                <a href="/connect" className="lp-pill-secondary lp-pill-sm !hidden md:!inline-flex">
                  Explore OpenWork Connect
                </a>
              }
            />
            <p className="mt-6 max-w-[640px] text-[16px] leading-[25px] text-[var(--lp-body)]">
              OpenWork Connect is our MCP gateway. Add a server or skill to your org
              once — every teammate and agent gets it instantly, in OpenWork and in
              any MCP-compatible client. Claude Cowork has no equivalent.
            </p>
            <a href="/connect" className="lp-pill-secondary lp-pill-sm mt-6 md:!hidden">
              Explore OpenWork Connect
            </a>
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
              <div className="grid items-start gap-6 md:grid-cols-3">
                <div className="group rounded-[24px] bg-[var(--lp-tonal)] p-7">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white">
                    <Monitor
                      className="lp-draw-icon h-5 w-5 text-[var(--lp-ink)]"
                      strokeWidth={1.75}
                    />
                  </span>
                  <h3 className="mt-4 text-[17px] font-medium">On your desktop</h3>
                  <p className="mt-2 max-w-[280px] text-[14px] leading-[22px] text-[var(--lp-body)] md:min-h-[66px]">
                    For macOS, Windows, and Linux. Local-first, no account needed.
                  </p>
                  <a
                    href={props.downloadHref}
                    className="lp-pill-primary lp-pill-sm mt-5"
                  >
                    Download for macOS
                  </a>
                </div>

                <div className="group rounded-[24px] bg-[var(--lp-tonal)] p-7">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white">
                    <Globe
                      className="lp-draw-icon h-5 w-5 text-[var(--lp-ink)]"
                      strokeWidth={1.75}
                    />
                  </span>
                  <h3 className="mt-4 flex items-center gap-2 text-[17px] font-medium">
                    In your browser <LpAlphaBadge />
                  </h3>
                  <p className="mt-2 max-w-[280px] text-[14px] leading-[22px] text-[var(--lp-body)] md:min-h-[66px]">
                    OpenWork Web. Nothing to install — sign in and run your first
                    task.
                  </p>
                  <a
                    href="https://app.openworklabs.com"
                    className="lp-pill-secondary lp-pill-sm mt-5"
                  >
                    Open in browser
                  </a>
                </div>

                <div className="group rounded-[24px] bg-[var(--lp-tonal)] p-7">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white">
                    <SquareTerminal
                      className="lp-draw-icon h-5 w-5 text-[var(--lp-ink)]"
                      strokeWidth={1.75}
                    />
                  </span>
                  <h3 className="mt-4 text-[17px] font-medium">From your agent</h3>
                  <p className="mt-2 max-w-[280px] text-[14px] leading-[22px] text-[var(--lp-body)] md:min-h-[66px]">
                    In Claude Code, Cursor, or Codex? One pasted prompt installs
                    and sets up OpenWork for you.
                  </p>
                  <LandingHeroPrompt compact className="mt-5" />
                </div>
              </div>
            </div>
          </section>

          <section className="mt-[120px]">
            <LpSectionHeader
              label="Where to next"
              heading="Take it to your team."
              size="small"
            />
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              <LpTonalCard className="flex min-h-[190px] flex-col justify-between p-6">
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

              <LpTonalCard className="flex min-h-[190px] flex-col justify-between p-6">
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

              <LpTonalCard className="flex min-h-[190px] flex-col justify-between p-6">
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

          <div className="mt-[120px] [&_h2]:!text-[36px] [&_h2]:!leading-[42px]">
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

          <div className="mt-16">
            <SiteFooter />
          </div>
        </main>
      </div>
    </div>
  );
}
