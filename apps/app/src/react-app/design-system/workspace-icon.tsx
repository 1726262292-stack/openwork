/** @jsxImportSource react */
import { grainArtSrc } from "./grain-art";

export type WorkspaceIconProps = {
  /** Workspace name used to seed the static gradient. Changes when renamed. */
  seed: string;
  /** CSS size class, e.g. "size-4", "size-5.5". Defaults to "size-4". */
  sizeClass?: string;
};

export function WorkspaceIcon({ seed, sizeClass = "size-4" }: WorkspaceIconProps) {
  return (
    <img
      src={grainArtSrc("workspaces", seed)}
      alt=""
      loading="lazy"
      decoding="async"
      className={`${sizeClass} shrink-0 rounded-full object-cover`}
    />
  );
}
