/** @jsxImportSource react */
import { getPaperAvatarStyle } from "./paper-avatar-svg";

export type WorkspaceIconProps = {
  /** Workspace name used to seed the gradient. Changes when renamed. */
  seed: string;
  /** CSS size class, e.g. "size-4", "size-5.5". Defaults to "size-4". */
  sizeClass?: string;
};

/**
 * Renders a small rounded circle with a deterministic static SVG background.
 * Renaming the workspace changes the generated paper-like gradient.
 */
export function WorkspaceIcon({ seed, sizeClass = "size-4" }: WorkspaceIconProps) {
  return (
    <div
      className={`${sizeClass} shrink-0 overflow-hidden rounded-full`}
      style={getPaperAvatarStyle(seed, "workspace")}
    />
  );
}
