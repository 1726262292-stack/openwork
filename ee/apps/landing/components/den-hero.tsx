"use client";

import { DenActivityPanel } from "./den-activity-panel";
import { SlackGlyph, TelegramGlyph } from "./den-icons";

type DenHeroProps = {
  getStartedHref: string;
};

export function DenHero(props: DenHeroProps) {
  const getStartedExternal = /^https?:\/\//.test(props.getStartedHref);

  return (
    <section className="grid gap-8 pt-8 md:pt-14 lg:grid-cols-[minmax(0,1.28fr)_minmax(320px,0.72fr)] lg:items-center">
      <div className="max-w-[42rem]">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-[0.18em] text-gray-500">
          OpenWork hosted
        </div>
        <h2 className="max-w-[12.4ch] text-3xl font-medium tracking-tight text-gray-900 md:max-w-[12.1ch] md:text-[3.2rem] md:leading-[0.98] lg:max-w-none lg:text-[3.35rem] xl:text-[3.7rem]">
          <span className="block lg:whitespace-nowrap">Always-on AI workers</span>
          <span className="block lg:whitespace-nowrap">for you and your team.</span>
        </h2>
        <p className="mt-5 max-w-[35rem] text-lg leading-relaxed text-gray-700 md:text-[1rem] md:leading-8 lg:text-[1.02rem]">
          Define a task, deploy a worker, check results from{" "}
          <span className="whitespace-nowrap">
            <SlackGlyph className="mr-1 inline-block align-[-0.15em]" />
            Slack
          </span>{" "}
          or{" "}
          <span className="whitespace-nowrap">
            <TelegramGlyph className="mr-1 inline-block align-[-0.15em]" />
            Telegram
          </span>
          . Den handles the repetitive work so your team can focus on what they&apos;re best at.
        </p>

        <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-5">
          <a
            href={props.getStartedHref}
            className="doc-button min-w-[290px] justify-center px-8 text-[1.08rem] font-semibold"
            rel={getStartedExternal ? "noreferrer" : undefined}
            target={getStartedExternal ? "_blank" : undefined}
          >
            Get started
          </a>
          <div className="flex flex-col text-[0.98rem] text-gray-500 sm:max-w-[14rem]">
            <span className="font-semibold text-gray-700">$50/mo per worker</span>
            <span>Free for a limited time</span>
          </div>
        </div>
      </div>

      <DenActivityPanel />
    </section>
  );
}
