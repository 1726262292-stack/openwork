"use client";

import { MeshGradient } from "@paper-design/shaders-react";

export function PaperMeshBackground({
  opacity = 1,
  className
}: {
  opacity?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity
      }}
    >
      <MeshGradient
        speed={0.02}
        distortion={0.8}
        swirl={0.1}
        grainMixer={0}
        grainOverlay={0}
        frame={64636.59999998804}
        scale={0.59}
        colors={["#FFFFFF", "#1B29FF"]}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
