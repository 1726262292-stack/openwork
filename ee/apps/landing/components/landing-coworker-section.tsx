"use client";
import { ArrowRight, Bot, Rocket } from "lucide-react";
import Link from "next/link";

export function LandingCoworkerSection() {
  return (
    <section className="landing-shell rounded-[2.5rem] p-8 md:p-12">
      <div className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        <Bot size={18} />
        Introducing
      </div>
      <h2 className="mb-5 max-w-2xl text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl lg:text-5xl">
        OpenWork Coworker.
        <br />
        Design, connect, and deploy AI coworkers from chat.
      </h2>
      <p className="mb-8 max-w-2xl text-lg leading-relaxed text-gray-700">
        Build a full coworker experience right from the OpenWork desktop
        interface, connect the tools that matter to you, and deploy it to Slack,
        email, and beyond — without hosting infrastructure or surrendering
        control.
      </p>

      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <Link href="/coworker" className="doc-button inline-flex items-center gap-2">
          Learn more <ArrowRight size={18} />
        </Link>
        <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[12px] font-medium text-blue-700">
          <Rocket size={12} />
          Private beta
        </div>
      </div>
    </section>
  );
}
