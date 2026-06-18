"use client";
import { Cloud } from "lucide-react";
import Link from "next/link";

export function LandingCloudSection() {
  return (
    <section className="landing-shell rounded-[2.5rem] p-8 md:p-12">
      <div className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        <Cloud size={18} />
        OpenWork Cloud
      </div>
      <h2 className="mb-5 max-w-2xl text-3xl font-medium leading-[1.15] tracking-tight md:text-4xl lg:text-5xl">
        Control your team&apos;s AI
        <br />
        workspace from a conversation.
      </h2>
      <p className="mb-8 max-w-2xl text-lg leading-relaxed text-gray-700">
        OpenWork Cloud is the control plane for shared skills, plugins,
        members, and providers — runnable from plain English. Local-first by
        default, cloud-ready when your team needs it.
      </p>

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Link href="/cloud" className="doc-button inline-flex items-center gap-2">
          Explore Cloud
        </Link>
        <span className="text-sm text-gray-500">
          Local-first by default. Cloud when you need it.
        </span>
      </div>
    </section>
  );
}
