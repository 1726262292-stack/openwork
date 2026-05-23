/** @jsxImportSource react */
import { CheckCircle2, Loader2, Plug2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import type { ExtensionKind } from "../../app/constants";
import { resolveExtensionIconSrc } from "./extension-icon-src";

export type ExtensionCardProps = {
  name: string;
  description: string;
  /** Simple Icons slug for brand icon. When set, loads from CDN. */
  iconSlug?: string;
  /** Direct icon URL (e.g. local SVG). Takes priority over iconSlug. */
  iconSrc?: string;
  /** Lucide icon fallback when no iconSlug or iconSrc is provided. */
  fallbackIcon?: LucideIcon;
  /** Extension category badge. */
  kind?: ExtensionKind;
  /** Whether the extension is already installed/connected. */
  connected?: boolean;
  /** Whether a connect operation is in progress. */
  connecting?: boolean;
  /** Whether interaction is disabled. */
  disabled?: boolean;
  /** Whether this item is hidden from the normal catalog view. */
  hidden?: boolean;
  /** Action label shown at bottom. */
  actionLabel?: string;
  /** Click handler. */
  onClick?: () => void;
};

const kindLabel: Record<ExtensionKind, string> = {
  mcp: "MCP",
  plugin: "Plugin",
  skill: "Skill",
  "ui-control": "UI Control",
  extension: "OpenWork Extension",
};

const kindStyle: Record<ExtensionKind, string> = {
  mcp: "bg-dls-hover text-dls-secondary",
  plugin: "bg-violet-3 text-violet-11",
  skill: "bg-amber-3 text-amber-11",
  "ui-control": "bg-blue-3 text-blue-11",
  extension: "bg-teal-3 text-teal-11",
};

function meshAvatarStyle(seed: string): CSSProperties {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  const a = hash;
  const b = (hash + 72) % 360;
  const c = (hash + 156) % 360;
  return {
    background:
      `radial-gradient(circle at 20% 20%, hsl(${a} 92% 72%), transparent 38%), ` +
      `radial-gradient(circle at 80% 12%, hsl(${b} 88% 66%), transparent 42%), ` +
      `radial-gradient(circle at 52% 90%, hsl(${c} 94% 68%), transparent 46%), ` +
      `linear-gradient(135deg, hsl(${a} 82% 54%), hsl(${b} 84% 48%))`,
  };
}

function meshAvatarText(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length >= 2
    ? `${words[0][0]}${words[1][0]}`
    : (words[0] ?? "E").slice(0, 2);
  return letters.toUpperCase();
}

/**
 * A reusable card for displaying an extension (MCP server, plugin, or skill)
 * in the extensions directory. Supports brand icons from Simple Icons CDN,
 * Lucide icon fallbacks, kind badges, and connected/connecting states.
 */
export function ExtensionCard(props: ExtensionCardProps) {
  const {
    name,
    description,
    iconSlug,
    iconSrc,
    fallbackIcon: FallbackIcon = Plug2,
    kind = "mcp",
    connected = false,
    connecting = false,
    disabled = false,
    hidden = false,
    actionLabel,
    onClick,
  } = props;
  const resolvedIconSrc = iconSrc ? resolveExtensionIconSrc(iconSrc) : undefined;

  return (
    <button
      type="button"
      disabled={disabled || connecting}
      onClick={onClick}
      className={`group w-full rounded-xl border p-4 text-left transition-all ${
        connected
          ? "border-green-6 bg-green-2"
          : "border-dls-border bg-dls-surface hover:bg-dls-hover"
      } ${hidden ? "border-dashed opacity-70" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="relative shrink-0">
          <div
            className={`flex size-10 items-center justify-center rounded-lg border ${
              connected ? "border-green-6 bg-green-2" : "border-dls-border bg-dls-hover"
            }`}
          >
            {connecting ? (
              <Loader2 size={18} className="animate-spin text-dls-secondary" />
            ) : resolvedIconSrc ? (
              <div className="flex size-6 items-center justify-center rounded-md bg-white">
                <img src={resolvedIconSrc} alt="" width={16} height={16} loading="lazy" style={{ display: "block" }} />
              </div>
            ) : iconSlug ? (
              <div className="flex size-6 items-center justify-center rounded-md bg-white">
                <img src={`https://cdn.simpleicons.org/${iconSlug}`} alt="" width={16} height={16} loading="lazy" style={{ display: "block" }} />
              </div>
            ) : (
              <div
                className="flex size-7 items-center justify-center rounded-md text-[10px] font-bold text-white shadow-inner"
                style={meshAvatarStyle(name)}
              >
                {kind === "plugin" ? meshAvatarText(name) : <FallbackIcon size={16} className="text-white/90" />}
              </div>
            )}
          </div>
          {connected ? (
            <div className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full border-2 border-dls-surface bg-green-9">
              <CheckCircle2 size={9} className="text-white" strokeWidth={3} />
            </div>
          ) : null}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-dls-text">{name}</h4>
            {connected ? (
              <span className="rounded-md bg-green-3 px-1.5 py-0.5 text-[10px] font-medium text-green-11">
                Connected
              </span>
            ) : (
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${kindStyle[kind]}`}>
                {kindLabel[kind]}
              </span>
            )}
            {hidden ? (
              <span className="rounded-md bg-gray-3 px-1.5 py-0.5 text-[10px] font-medium text-gray-11">
                Hidden
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-dls-secondary">{description}</p>
          {!connecting && actionLabel ? (
            <div className="mt-2 text-[11px] font-medium text-dls-text transition-colors group-hover:opacity-80">
              {actionLabel}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}
