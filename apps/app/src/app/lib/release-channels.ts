/**
 * Release-channel concept for OpenWork desktop builds.
 *
 * There are four channels users can opt into:
 *
 * - "stable": the default. The desktop app auto-updates from the rolling
 *   "latest" GitHub release attached to whichever semver tag most recently
 *   finished the Release App workflow. macOS, Linux, Windows.
 *
 * - "alpha": a macOS-only rolling channel that auto-updates on every merge
 *   to `dev`. Alpha builds are published to a fixed GitHub release tag
 *   (`alpha-macos-latest`) so the updater endpoint stays stable while the
 *   underlying artifact is replaced on every dev push.
 *
 * - "canary" and "experimental": hidden Electron/macOS-only rolling channels
 *   used by the corresponding long-lived branches. The UI exposes these only
 *   while elevated Developer mode is enabled.
 *
 * Only macOS (arm64) prerelease builds are published today. Linux and Windows
 * always resolve to the stable channel.
 */

import type { ReleaseChannel } from "../types";

/** Stable channel's Tauri updater manifest URL. */
export const STABLE_UPDATER_ENDPOINT =
  "https://github.com/different-ai/openwork/releases/latest/download/latest.json";

/** Alpha channel's Tauri updater manifest URL (macOS-only, rolling). */
export const ALPHA_UPDATER_ENDPOINT =
  "https://github.com/different-ai/openwork/releases/download/alpha-macos-latest/latest.json";

/** Rolling GitHub release tag that alpha macOS artifacts are published to. */
export const ALPHA_MACOS_RELEASE_TAG = "alpha-macos-latest";

export const CANARY_MACOS_RELEASE_TAG = "canary-macos-latest";
export const EXPERIMENTAL_MACOS_RELEASE_TAG = "experimental-macos-latest";

export type PlatformKind = "darwin" | "linux" | "windows" | "web" | "unknown";

export function isPrereleaseChannel(
  channel: ReleaseChannel,
): channel is Exclude<ReleaseChannel, "stable"> {
  return channel !== "stable";
}

export function isPreAlphaChannel(
  channel: ReleaseChannel,
): channel is Extract<ReleaseChannel, "canary" | "experimental"> {
  return channel === "canary" || channel === "experimental";
}

export function visibleReleaseChannels(
  elevatedDeveloperMode: boolean,
): ReleaseChannel[] {
  return elevatedDeveloperMode
    ? ["stable", "alpha", "canary", "experimental"]
    : ["stable", "alpha"];
}

/**
 * Returns true when the given platform supports the alpha channel.
 *
 * Today alpha builds are produced only for macOS (arm64). The type-level
 * conservatism here is deliberate: it's easier to widen later than to
 * silently start advertising an alpha endpoint that serves no artifact.
 */
export function isAlphaChannelSupported(platform: PlatformKind): boolean {
  return platform === "darwin";
}

/**
 * Resolve the Tauri updater manifest URL for the requested channel.
 *
 * Falls back to the stable endpoint whenever alpha isn't supported on the
 * current platform, so the caller never needs to special-case "alpha chosen
 * on Linux" / "alpha chosen on Windows" etc.
 */
export function resolveUpdaterEndpoint(
  channel: ReleaseChannel,
  platform: PlatformKind = "darwin",
): string {
  if (!isAlphaChannelSupported(platform)) {
    return STABLE_UPDATER_ENDPOINT;
  }
  if (channel === "alpha") return ALPHA_UPDATER_ENDPOINT;
  // Canary and Experimental publish Electron's latest-mac.yml manifest, not
  // the retired Tauri latest.json format used by this legacy resolver.
  return STABLE_UPDATER_ENDPOINT;
}

/** Narrow an arbitrary string to a valid ReleaseChannel, defaulting to stable. */
export function coerceReleaseChannel(value: unknown): ReleaseChannel {
  return value === "alpha" || value === "canary" || value === "experimental"
    ? value
    : "stable";
}
