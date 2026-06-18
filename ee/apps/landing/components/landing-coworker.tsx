"use client";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Mail,
  MessageSquare,
  Rocket,
  Settings2,
  Terminal,
  Wrench,
  X
} from "lucide-react";
import { LandingBackground } from "./landing-background";
import { LandingCoworkerChatDemo } from "./landing-coworker-chat-demo";
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

const problemPaths = [
  {
    label: "Option A · Self-host",
    title: "Run the entire stack yourself",
    body: "Provision servers, write code, maintain infrastructure, handle updates and downtime. You become the platform team.",
    bad: true
  },
  {
    label: "Option B · Locked-in SaaS",
    title: "Let the platform decide for you",
    body: "Restricted tool selection, rigid workflows, and someone else's idea of how your team should work. It doesn't fit.",
    bad: true
  }
];

const ourWay = [
  {
    icon: Settings2,
    title: "Design it your way",
    body: "Build the full coworker experience right from the OpenWork desktop chat. Pick the skills, MCPs, and tools that matter to you — no code, no infra."
  },
  {
    icon: Wrench,
    title: "Connect what matters",
    body: "Slack, HubSpot, Notion, email, your internal tools — anything with an MCP server. You choose the connections, not the platform."
  },
  {
    icon: Rocket,
    title: "Deploy from chat",
    body: "When it's ready, deploy straight from the conversation. Your coworker goes live on Slack, email, or wherever your team works."
  }
];

const channels = [
  { name: "Slack", icon: MessageSquare, tone: "bg-gradient-to-br from-violet-400 to-purple-500" },
  { name: "Email", icon: Mail, tone: "bg-gradient-to-br from-sky-400 to-blue-500" },
  { name: "Telegram", icon: MessageSquare, tone: "bg-gradient-to-br from-amber-400 to-orange-400" }
];

export function LandingCoworker(props: Props) {
  const callLinkProps = externalLinkProps(props.callHref);
  const primaryCtaHref = CLOUD_SIGNUP_URL;
  const primaryCtaLabel = "Join the private beta";
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
            mobilePrimaryLabel="Join the private beta"
          />
        </div>

        <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 pb-24 md:gap-20 md:px-8 md:pb-28">
          {/* Hero */}
          <section className="pt-8 md:pt-12">
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
              <div className="max-w-xl">
                <div className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                  <Bot size={18} />
                  Introducing
                </div>
                <h1 className="mb-5 text-4xl font-medium leading-[1.1] tracking-tight md:text-5xl lg:text-[3.25rem]">
                  OpenWork Coworker
                </h1>
                <p className="max-w-3xl text-lg leading-relaxed text-gray-700 md:text-xl">
                  Design a full AI coworker right from the OpenWork desktop chat,
                  connect the tools that matter to you, and deploy it to Slack,
                  email, and beyond — without hosting infrastructure or
                  surrendering control.
                </p>

                <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[12px] font-medium text-blue-700">
                  <Rocket size={12} />
                  Available in private beta
                </div>

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

                <p className="mt-4 text-[13px] text-gray-500">
                  Teams using OpenWork Models or OpenWork Cloud get access first.
                </p>
              </div>

              <div className="flex justify-center lg:justify-end">
                <LandingCoworkerChatDemo />
              </div>
            </div>
          </section>

          {/* The problem */}
          <section>
            <div className="mb-12 max-w-2xl">
              <h2 className="mb-4 text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl">
                Teams deploying AI coworkers face two bad options.
              </h2>
              <p className="text-lg leading-relaxed text-gray-700">
                We talked to many teams who deploy AI coworkers onto Slack,
                email, and beyond. They all hit the same wall.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {problemPaths.map((path) => (
                <div
                  key={path.label}
                  className="relative rounded-[2rem] border border-gray-200 bg-white p-6 md:p-8"
                >
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-red-700">
                    <X size={12} />
                    {path.label}
                  </div>
                  <h3 className="mb-2 text-xl font-medium tracking-tight text-[#011627]">
                    {path.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-gray-500">
                    {path.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Our way */}
          <section className="landing-shell rounded-[2.5rem] p-8 md:p-12">
            <div className="mb-12 max-w-2xl">
              <div className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                <Bot size={18} />
                The OpenWork way
              </div>
              <h2 className="mb-4 text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl">
                You design it. You connect it. You deploy it.
              </h2>
              <p className="text-lg leading-relaxed text-gray-700">
                All from the desktop chat interface. No infrastructure to host,
                no platform making decisions for you.
              </p>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              {ourWay.map((item, i) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={item.title}
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-10% 0px" }}
                    transition={{ duration: 0.3, delay: i * 0.1 }}
                    className="flex flex-col gap-3"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-100 bg-gray-50/80 text-[#011627]">
                      <Icon size={18} />
                    </div>
                    <h3 className="text-lg font-medium tracking-tight text-[#011627]">
                      {item.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-gray-500">
                      {item.body}
                    </p>
                  </motion.div>
                );
              })}
            </div>

            {/* Channels strip */}
            <div className="mt-10 flex flex-col gap-4 border-t border-gray-100 pt-8">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                Deploy to where your team already works
              </div>
              <div className="flex flex-wrap gap-3">
                {channels.map((channel) => {
                  const Icon = channel.icon;
                  return (
                    <div
                      key={channel.name}
                      className="flex items-center gap-2.5 rounded-full border border-gray-100 bg-white px-4 py-2 shadow-sm"
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full ${channel.tone}`}
                      >
                        <Icon size={12} className="text-white" />
                      </span>
                      <span className="text-[13px] font-medium text-[#011627]">
                        {channel.name}
                      </span>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2.5 rounded-full border border-dashed border-gray-200 bg-gray-50/50 px-4 py-2">
                  <Terminal size={14} className="text-gray-400" />
                  <span className="text-[13px] text-gray-400">
                    + any MCP server
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Beta CTA */}
          <section className="landing-shell rounded-[2.5rem] p-8 text-center md:p-12">
            <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[12px] font-medium text-blue-700">
              <Rocket size={12} />
              Private beta · available now
            </div>
            <h2 className="mx-auto mb-4 max-w-2xl text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl">
              Be the first to get access.
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-gray-700">
              Sign up at openworklabs.com to join the private beta. Teams using
              OpenWork Models or OpenWork Cloud get access first.
            </p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={primaryCtaHref}
                className="doc-button inline-flex items-center gap-2"
                {...primaryCtaLinkProps}
              >
                Join the private beta <ArrowRight size={18} />
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
