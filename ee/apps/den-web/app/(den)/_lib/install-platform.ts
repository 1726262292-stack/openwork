import type { DetectedOS, DetectedPlatform } from "@openwork/ui/react";

export type InstallPlatform =
  | "mac-arm64"
  | "mac-x64"
  | "win-x64"
  | "win-arm64"
  | "linux-x64"
  | "linux-arm64";

export type InstallPlatformOption = {
  value: InstallPlatform;
  label: string;
  os: DetectedOS;
};

export const installPlatformOptions: InstallPlatformOption[] = [
  { value: "mac-arm64", label: "Mac (Apple silicon)", os: "macos" },
  { value: "mac-x64", label: "Mac (Intel)", os: "macos" },
  { value: "win-x64", label: "Windows (x64)", os: "windows" },
  { value: "win-arm64", label: "Windows (ARM64)", os: "windows" },
  { value: "linux-x64", label: "Linux (x64)", os: "linux" },
  { value: "linux-arm64", label: "Linux (ARM64)", os: "linux" },
];

export function recommendedInstallPlatform(detected: DetectedPlatform | null): InstallPlatform | null {
  if (!detected) return null;
  if (detected.os === "linux") return detected.arch === "arm64" ? "linux-arm64" : "linux-x64";
  if (!detected.arch) return null;
  if (detected.os === "macos") return detected.arch === "arm64" ? "mac-arm64" : "mac-x64";
  return detected.arch === "arm64" ? "win-arm64" : "win-x64";
}

export function installPlatformsForOs(os: DetectedOS | undefined) {
  return installPlatformOptions.filter((option) => option.os === os);
}
