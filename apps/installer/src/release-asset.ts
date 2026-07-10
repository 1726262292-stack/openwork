export type ReleaseAsset = {
  version: string
  fileName: string
  url: string
  type: "dmg" | "exe" | "appimage"
}

/**
 * Release assets follow a fixed naming scheme, but the download URL belongs to
 * the deployment and comes from Den's /v1/app-version response. The installer
 * must never invent a public-release host on its own.
 */
export function releaseAssetFor(input: {
  version: string
  url: string
  platform?: NodeJS.Platform
  arch?: string
}): ReleaseAsset {
  const { version, url } = input
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const normalized = version.trim().replace(/^v/i, "")
  if (!normalized) throw new Error("version is required")
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`unsupported release URL protocol: ${parsedUrl.protocol}`)
  }
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`unsupported architecture: ${arch}`)
  }

  const build = (fileName: string, type: ReleaseAsset["type"]): ReleaseAsset => ({
    version: normalized,
    fileName,
    type,
    url: parsedUrl.toString(),
  })

  if (platform === "darwin") {
    return build(`openwork-mac-${arch}-${normalized}.dmg`, "dmg")
  }
  if (platform === "win32") {
    return build(`openwork-win-${arch}-${normalized}.exe`, "exe")
  }
  if (platform === "linux") {
    // The AppImage uses x86_64 in its name while the tarball uses x64.
    const appImageArch = arch === "x64" ? "x86_64" : "arm64"
    return build(`openwork-linux-${appImageArch}-${normalized}.AppImage`, "appimage")
  }
  throw new Error(`unsupported platform: ${platform}`)
}

export function releasePlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
) {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return `mac-${arch}`
  }
  if (platform === "win32" && (arch === "arm64" || arch === "x64")) {
    return `win-${arch}`
  }
  throw new Error(`deployment desktop releases do not support ${platform}/${arch}`)
}
