export function externalUrlCommand(url: string, platform: NodeJS.Platform = process.platform): string[] {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only browser URLs can be opened.")
  }
  if (platform === "darwin") return ["open", parsed.toString()]
  if (platform === "win32") return ["cmd", "/c", "start", "", parsed.toString()]
  return ["xdg-open", parsed.toString()]
}

export async function openExternalUrl(url: string): Promise<boolean> {
  if (process.env.OPENWORK_INSTALLER_DISABLE_BROWSER_OPEN === "1") {
    return false
  }
  try {
    const child = Bun.spawn(externalUrlCommand(url), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    return await child.exited === 0
  } catch {
    return false
  }
}
