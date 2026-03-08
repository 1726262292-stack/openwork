"use client";

import { ResponsiveGrain } from "./responsive-grain";

export function LandingBackground() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[58vh] overflow-hidden md:h-[70vh]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.88),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(191,219,254,0.26),_transparent_30%),linear-gradient(180deg,_rgba(246,249,252,1)_0%,_rgba(246,249,252,0.82)_60%,_rgba(246,249,252,0)_100%)]" />
      <ResponsiveGrain
        colors={["#f6f9fc", "#eef4f8", "#dbe7ef", "#f8fafc"]}
        colorBack="#f6f9fc"
        softness={1}
        intensity={0.025}
        noise={0.08}
        shape="corners"
        speed={0.035}
      />
    </div>
  );
}
