"use client";
import {
  ArrowRight,
  BrainCircuit,
  Cloud,
  PlugZap,
  Send,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { LandingBackground } from "./landing-background";
import { LandingCloudChatDemo } from "./landing-cloud-chat-demo";
import { SiteFooter } from "./site-footer";
import { SiteNav } from "./site-nav";

type Props = {
  stars: string;
  downloadHref: string;
  callHref: string;
};

const CLOUD_SIGNUP_URL = "https://app.openworklabs.com?mode=sign-up";

const externalLinkProps = (href: string) =>
  /^https?:\/\//.test(href)
    ? { rel: "noreferrer", target: "_blank" as const }
    : {};

function ComingSoonBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-700">
      <Sparkles size={10} />
      Coming soon
    </span>
  );
}

const features = [
  {
    icon: Cloud,
    title: "Hosted workers",
    comingSoon: true,
    body: "Deploy a worker on sandboxed infrastructure, reachable from desktop, browser, or chat. Each workspace gets its own subdomain."
  },
  {
    icon: Send,
    title: "Share & import",
    body: "Package skills, MCPs, plugins, and configs into a single link. Teammates import the whole setup in one click — no terminal, no setup guide, no technical knowledge needed."
  },
  {
    icon: BrainCircuit,
    title: "Managed models",
    body: "Give every teammate instant model access. OpenWork Models hosts frontier open-source models for $10 a seat — no provider accounts, no key juggling, every member provisioned automatically."
  },
  {
    icon: PlugZap,
    title: "Extension marketplace",
    body: "Ship reusable skills, MCPs, and plugins to your team through a marketplace. Import from the built-in OpenWork Marketplace or any GitHub repo in a couple of clicks."
  },
  {
    icon: ShieldCheck,
    title: "Org controls",
    body: "SSO/SAML, SCIM provisioning, RBAC, and desktop policies. Decide which providers, models, and extensions your team can use — enforced automatically by the desktop app."
  },
  {
    icon: Sparkles,
    title: "Cloud MCP",
    body: "Talk to your Cloud org from any MCP client — or right inside OpenWork. Invite teammates, share skills, and manage your workspace from plain English."
  }
];

const steps = [
  {
    n: "01",
    title: "Build locally",
    body: "Create skills, MCPs, plugins, and configs in the desktop app. Test on your own files with your own keys."
  },
  {
    n: "02",
    title: "Share to Cloud",
    body: "Spin up a shared workspace or send a link. Your team imports the setup in one click — no setup guide required."
  },
  {
    n: "03",
    title: "Run & govern",
    body: "Manage members, providers, and policy from one dashboard — or just ask in plain English through the Cloud MCP."
  }
];

export function LandingCloud(props: Props) {
  const callLinkProps = externalLinkProps(props.callHref);
  const primaryCtaHref = CLOUD_SIGNUP_URL;
  const primaryCtaLabel = "Get Started for free";
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
            active="cloud"
          />
        </div>

        <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 pb-24 md:gap-20 md:px-8 md:pb-28">
          {/* Hero */}
          <section className="pt-8 md:pt-12">
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
              <div className="max-w-xl">
                <div className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                  <Cloud size={18} />
                  OpenWork Cloud
                </div>
                <h1 className="mb-5 text-4xl font-medium leading-[1.1] tracking-tight md:text-5xl lg:text-[3.25rem]">
                  Control your team&apos;s AI workspace from a conversation.
                </h1>
                <p className="max-w-3xl text-lg leading-relaxed text-gray-700 md:text-xl">
                  OpenWork Cloud is the control plane for shared skills,
                  plugins, members, and providers — and you can run it all from
                  plain English. Local-first by default, cloud-ready when your
                  team needs it.
                </p>

                <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
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
              </div>

              <div className="flex justify-center lg:justify-end">
                <LandingCloudChatDemo />
              </div>
            </div>
          </section>

          {/* Features */}
          <section>
            <div className="mb-12 max-w-2xl">
              <h2 className="mb-4 text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl">
                Everything you get with Cloud.
              </h2>
              <p className="text-lg leading-relaxed text-gray-700">
                A complete control plane for team access, shared runtime state,
                and reusable agent setups — on top of the open-source core.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={feature.title}
                    className="feature-card flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-100 bg-gray-50/80 text-[#011627]">
                        <Icon size={18} />
                      </div>
                      {feature.comingSoon ? <ComingSoonBadge /> : null}
                    </div>
                    <h3 className="text-lg font-medium tracking-tight text-[#011627]">
                      {feature.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-gray-500">
                      {feature.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* How it works */}
          <section className="landing-shell rounded-[2.5rem] p-8 md:p-12">
            <div className="mb-12 max-w-2xl">
              <h2 className="mb-4 text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl">
                Local-first. Cloud-ready.
              </h2>
              <p className="text-lg leading-relaxed text-gray-700">
                Start on your machine. Move to the cloud when your team needs
                shared setups or org-wide governance.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              {steps.map((step) => (
                <div key={step.n} className="flex flex-col gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-sm font-semibold text-[#011627]">
                    {step.n}
                  </div>
                  <h3 className="text-lg font-medium tracking-tight text-[#011627]">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-500">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Closing CTA */}
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
        </main>
      </div>
    </div>
  );
}
