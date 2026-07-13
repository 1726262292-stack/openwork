import { LoaderCircle } from "lucide-react";
import type { CSSProperties } from "react";

const spinnerStyle: CSSProperties = {
  animationName: "spin",
  animationDuration: "1s",
  animationTimingFunction: "linear",
  animationIterationCount: "infinite",
};

export function InstallDownloadSpinner() {
  return (
    <LoaderCircle
      aria-hidden="true"
      className="size-5 animate-spin text-[var(--dls-accent)]"
      data-testid="install-download-spinner"
      style={spinnerStyle}
    />
  );
}
