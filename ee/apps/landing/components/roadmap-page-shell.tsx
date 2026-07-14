import { OpenWorkRoadmap } from "@openwork/ui/react";
import { LandingBackground } from "./landing-background";
import { SiteFooter } from "./site-footer";
import { SiteNav } from "./site-nav";

export function RoadmapPageShell({ stars }: { stars: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden text-[#011627]">
      <LandingBackground />

      <div className="relative z-10">
        <SiteNav stars={stars} active="roadmap" />
        <main className="mx-auto w-full max-w-6xl px-6 md:px-8">
          <OpenWorkRoadmap />
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}
