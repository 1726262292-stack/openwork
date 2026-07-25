import { describe, expect, test } from "bun:test"
import { Buffer } from "node:buffer"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { installConfigUrlFor } from "@openwork/install-config"

import {
  appleScriptString,
  buildCompressedDmgArgs,
  buildFinderLayoutScript,
  buildReadWriteDmgArgs,
  buildTiffutilArgs,
  dmgBackgroundPaths,
  dmgLayout,
  dmgVolumeName,
  dmgWindowBounds,
} from "../scripts/dmg-layout.mjs"
import { resolveInstallerVersion, versionFromReleaseTag, windowsFileVersion } from "../scripts/installer-version.mjs"
import { desktopBootstrapPath, legacyDesktopBootstrapPath } from "../src/bootstrap-path"
import { buildConstantsConfig, parseInstallLinkInput, resolveInstallLinkConfig, resolveInstallerConfig } from "../src/config"
import { removableInstallerBundlePath, windowsInstalledExePath, writeBootstrapConfig } from "../src/install"
import { externalUrlCommand } from "../src/open-external-url"
import { releaseAssetFor } from "../src/release-asset"
import { startInstallerServer } from "../src/server"
import {
  DARWIN_KEYCHAINS,
  createSystemCaFetch,
  loadExtraCaCertificates,
  parseDarwinSecurityCertificates,
  parseWindowsPowerShellCertificates,
  resolveSystemCaBundle,
  summarizeSystemCaSources,
  type SystemCaLoaders,
} from "../src/system-ca"
import { renderInstallerHtml } from "../src/ui-html"
import { INSTALLER_VERSION } from "../src/version"

type SelfSignedCertificate = {
  cert: string
  key: string
  cleanup: () => void
}

function createSelfSignedCertificate(): SelfSignedCertificate {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openwork-installer-tls-"))
  const certPath = path.join(dir, "cert.pem")
  const keyPath = path.join(dir, "key.pem")
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "1",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "ignore" })
  return {
    cert: readFileSync(certPath, "utf8"),
    key: readFileSync(keyPath, "utf8"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function startTlsInstallConfigServer(certificate: SelfSignedCertificate) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    tls: { cert: certificate.cert, key: certificate.key },
    fetch: () => Response.json({
      clientName: "TLS Corp",
      webUrl: "https://tls.example.com/",
      apiUrl: "https://tls-api.example.com/",
      requireSignin: true,
      logoUrl: null,
    }),
  })
}

function windowsPowerShellCertBlock(base64: string): string {
  return `-----OPENWORK-CERTIFICATE-----\n${base64}\n-----END-OPENWORK-CERTIFICATE-----`
}

function pemForBase64(base64: string): string {
  const lines: string[] = []
  for (let index = 0; index < base64.length; index += 64) {
    lines.push(base64.slice(index, index + 64))
  }
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`
}

describe("mac DMG layout helpers", () => {
  test("builds the approved Finder window and icon layout", () => {
    expect(dmgWindowBounds(dmgLayout.window)).toEqual([100, 100, 760, 500])

    const script = buildFinderLayoutScript({
      appName: "Install OpenWork.app",
      backgroundPath: "/Volumes/Install OpenWork/.background/bg.tiff",
      mountPoint: "/Volumes/Install OpenWork",
    })

    expect(script).toContain("set bounds of dmgWindow to {100, 100, 760, 500}")
    expect(script).toContain("set icon size of viewOptions to 128")
    expect(script).toContain("set label position of viewOptions to bottom")
    expect(script).toContain("set background picture of viewOptions to backgroundFile")
    expect(script).toContain('set position of item "Install OpenWork.app" of dmgWindow to {330, 180}')
  })

  test("builds DMG background and hdiutil arguments", () => {
    expect(dmgBackgroundPaths("/tmp/root")).toEqual({
      backgroundDir: "/tmp/root/.background",
      tiff: "/tmp/root/.background/bg.tiff",
    })
    expect(buildTiffutilArgs("/assets/dmg-background", "/tmp/root/.background/bg.tiff")).toEqual([
      "-cathidpicheck",
      "/assets/dmg-background/bg.png",
      "/assets/dmg-background/bg@2x.png",
      "-out",
      "/tmp/root/.background/bg.tiff",
    ])
    expect(buildReadWriteDmgArgs({ sourceFolder: "/tmp/root", outputPath: "/tmp/openwork.rw.dmg" })).toEqual([
      "create",
      "-format",
      "UDRW",
      "-volname",
      "Install OpenWork",
      "-srcfolder",
      "/tmp/root",
      "-ov",
      "/tmp/openwork.rw.dmg",
    ])
    expect(buildCompressedDmgArgs({ inputPath: "/tmp/openwork.rw.dmg", outputPath: "/tmp/OpenWork.dmg" })).toEqual([
      "convert",
      "/tmp/openwork.rw.dmg",
      "-format",
      "UDZO",
      "-ov",
      "-o",
      "/tmp/OpenWork.dmg",
    ])
  })

  test("escapes AppleScript strings", () => {
    expect(appleScriptString('/tmp/Install "OpenWork"/back\\ground.tiff')).toBe('/tmp/Install \\"OpenWork\\"/back\\\\ground.tiff')
  })

  test("names the mounted volume after the build being installed", () => {
    expect(dmgVolumeName("0.18.1")).toBe("Install OpenWork 0.18.1")
    expect(dmgVolumeName("")).toBe("Install OpenWork")
    expect(buildReadWriteDmgArgs({ sourceFolder: "/tmp/root", outputPath: "/tmp/openwork.rw.dmg", volumeName: "Install OpenWork 0.18.1" })).toContain(
      "Install OpenWork 0.18.1",
    )
  })
})

describe("installer version resolution", () => {
  test("reads the version out of a release tag", () => {
    expect(versionFromReleaseTag("v0.18.1")).toBe("0.18.1")
    expect(versionFromReleaseTag("0.18.1")).toBe("0.18.1")
    expect(versionFromReleaseTag(" v1.2.3-rc.1 ")).toBe("1.2.3-rc.1")
  })

  test("ignores tags that are not releases", () => {
    expect(versionFromReleaseTag("installer-release-e2e-abc123")).toBe("")
    expect(versionFromReleaseTag("v0.18")).toBe("")
    expect(versionFromReleaseTag("")).toBe("")
    expect(versionFromReleaseTag(undefined)).toBe("")
  })

  test("prefers an explicit version, then the release tag, then package.json", () => {
    expect(resolveInstallerVersion({ explicit: "9.9.9", releaseTag: "v0.18.1", packageVersion: "0.1.0" })).toBe("9.9.9")
    expect(resolveInstallerVersion({ releaseTag: "v0.18.1", packageVersion: "0.1.0" })).toBe("0.18.1")
    expect(resolveInstallerVersion({ releaseTag: "not-a-release", packageVersion: "0.1.0" })).toBe("0.1.0")
    expect(resolveInstallerVersion({})).toBe("")
  })

  test("reduces a version to a four-field Windows resource", () => {
    expect(windowsFileVersion("0.18.1")).toBe("0.18.1.0")
    expect(windowsFileVersion("1.2.3-rc.1")).toBe("1.2.3.0")
    expect(windowsFileVersion("nightly")).toBe("")
  })

  test("shows the build in the installer window without competing with the primary action", () => {
    const html = renderInstallerHtml(null, "token")
    expect(html).toContain(`<div class="version">Installer ${INSTALLER_VERSION}</div>`)
    expect(html).toContain(".version { position: fixed;")
    expect(INSTALLER_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe("desktopBootstrapPath", () => {
  test("honors the explicit override", () => {
    expect(desktopBootstrapPath({ OPENWORK_DESKTOP_BOOTSTRAP_PATH: "/tmp/custom.json" }, "darwin")).toBe("/tmp/custom.json")
  })

  test("prefers XDG_CONFIG_HOME on every platform", () => {
    expect(desktopBootstrapPath({ XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe(path.join("/xdg", "openwork", "desktop-bootstrap.json"))
    expect(desktopBootstrapPath({ XDG_CONFIG_HOME: "/xdg" }, "win32")).toBe(path.join("/xdg", "openwork", "desktop-bootstrap.json"))
  })

  test("uses LOCALAPPDATA on Windows and ~/.config elsewhere", () => {
    expect(desktopBootstrapPath({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32")).toBe(
      path.join("C:\\Users\\u\\AppData\\Local", "openwork", "desktop-bootstrap.json"),
    )
    expect(desktopBootstrapPath({}, "darwin")).toBe(path.join(os.homedir(), ".config", "openwork", "desktop-bootstrap.json"))
  })

  test("resolves the legacy bootstrap path under ~/.config on every platform", () => {
    expect(legacyDesktopBootstrapPath({ HOME: "/Users/u" }, "darwin")).toBe(
      path.join("/Users/u", ".config", "openwork", "desktop-bootstrap.json"),
    )
    expect(legacyDesktopBootstrapPath({ USERPROFILE: "C:\\Users\\u" }, "win32")).toBe(
      path.join("C:\\Users\\u", ".config", "openwork", "desktop-bootstrap.json"),
    )
  })
})

describe("releaseAssetFor", () => {
  test("resolves per-platform asset names", () => {
    expect(releaseAssetFor("v0.17.7", "darwin", "arm64").fileName).toBe("openwork-mac-arm64-0.17.7.dmg")
    expect(releaseAssetFor("0.17.7", "darwin", "x64").fileName).toBe("openwork-mac-x64-0.17.7.dmg")
    expect(releaseAssetFor("0.17.7", "win32", "x64").fileName).toBe("openwork-win-x64-0.17.7.exe")
    expect(releaseAssetFor("0.17.7", "linux", "x64").fileName).toBe("openwork-linux-x86_64-0.17.7.AppImage")
    expect(releaseAssetFor("0.17.7", "linux", "arm64").fileName).toBe("openwork-linux-arm64-0.17.7.AppImage")
  })

  test("builds the release download URL from the version tag", () => {
    expect(releaseAssetFor("0.17.7", "darwin", "arm64").url).toBe(
      "https://github.com/different-ai/openwork/releases/download/v0.17.7/openwork-mac-arm64-0.17.7.dmg",
    )
  })

  test("rejects unsupported targets", () => {
    expect(() => releaseAssetFor("0.17.7", "win32", "arm64")).toThrow()
    expect(() => releaseAssetFor("", "darwin", "arm64")).toThrow()
  })
})

test("browser activation uses each platform's standard URL opener", () => {
  const url = "https://den.example.test/activate?code=one-time-code"
  expect(externalUrlCommand(url, "darwin")).toEqual(["open", url])
  expect(externalUrlCommand(url, "win32")).toEqual(["cmd", "/c", "start", "", url])
  expect(externalUrlCommand(url, "linux")).toEqual(["xdg-open", url])
  expect(() => externalUrlCommand("openwork://connect", "darwin")).toThrow()
})

describe("windowsInstalledExePath", () => {
  test("reports the installed electron-builder package directory", () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "openwork-installed-path-"))
    const installed = path.join(temp, "Programs", "@openworkdesktop", "OpenWork.exe")
    mkdirSync(path.dirname(installed), { recursive: true })
    writeFileSync(installed, "")
    try {
      expect(windowsInstalledExePath(temp)).toBe(installed)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })
})

describe("resolveInstallerConfig", () => {
  test("reads env overrides and normalizes URLs", async () => {
    const { config, source } = await resolveInstallerConfig({ env: {
      OPENWORK_INSTALLER_APP_NAME: "Acme Work",
      OPENWORK_INSTALLER_CLIENT_NAME: "Acme Corp",
      OPENWORK_INSTALLER_WEB_URL: "https://openwork.acme.com/",
      OPENWORK_INSTALLER_API_URL: "https://openwork-api.acme.com",
      OPENWORK_INSTALLER_REQUIRE_SIGNIN: "true",
    } })
    expect(source).toBe("env")
    expect(config).toEqual({
      appName: "Acme Work",
      clientName: "Acme Corp",
      webUrl: "https://openwork.acme.com",
      apiUrl: "https://openwork-api.acme.com",
      logoUrl: null,
      requireSignin: true,
    })
  })

  test("accepts an optional logo URL and rejects non-http logos", async () => {
    const { config } = await resolveInstallerConfig({ env: {
      OPENWORK_INSTALLER_CLIENT_NAME: "Acme",
      OPENWORK_INSTALLER_WEB_URL: "https://openwork.acme.com",
      OPENWORK_INSTALLER_API_URL: "https://openwork-api.acme.com",
      OPENWORK_INSTALLER_LOGO_URL: "https://acme.com/logo.svg",
    } })
    expect(config.logoUrl).toBe("https://acme.com/logo.svg")
    await expect(
      resolveInstallerConfig({
        env: {
        OPENWORK_INSTALLER_CLIENT_NAME: "Acme",
        OPENWORK_INSTALLER_WEB_URL: "https://openwork.acme.com",
        OPENWORK_INSTALLER_API_URL: "https://openwork-api.acme.com",
        OPENWORK_INSTALLER_LOGO_URL: "file:///etc/passwd",
        },
      }),
    ).rejects.toThrow()
  })

  test("fails without a configured deployment", async () => {
    await expect(resolveInstallerConfig({ env: {} })).rejects.toThrow()
  })

  test("prefers env overrides over pasted install links", async () => {
    const resolution = await resolveInstallerConfig({
      env: {
        OPENWORK_INSTALLER_CLIENT_NAME: "Env",
        OPENWORK_INSTALLER_WEB_URL: "https://env.example.com",
        OPENWORK_INSTALLER_API_URL: "https://env-api.example.com",
      },
      installLink: "not an install link",
    })

    expect(resolution.source).toBe("env")
    expect(resolution.config.clientName).toBe("Env")
  })

  test("reads build constants before pasted install links", async () => {
    const resolution = await resolveInstallerConfig({
      env: {},
      buildConstants: {
        appName: "Build Work",
        clientName: "Build Corp",
        webUrl: "https://build.example.com/",
        apiUrl: "https://build-api.example.com/",
        logoUrl: "https://build.example.com/logo.svg",
        requireSignin: true,
      },
      installLink: "https://app.example.com/install?token=abcDEF12",
      fetcher: () => {
        throw new Error("install link should not be fetched when build constants exist")
      },
    })

    expect(resolution.source).toBe("build")
    expect(resolution.config).toEqual({
      appName: "Build Work",
      clientName: "Build Corp",
      webUrl: "https://build.example.com",
      apiUrl: "https://build-api.example.com",
      logoUrl: "https://build.example.com/logo.svg",
      requireSignin: true,
    })
  })

  test("ignores empty placeholder build constants", () => {
    expect(buildConstantsConfig({
      appName: "",
      clientName: "",
      webUrl: "",
      apiUrl: "",
      logoUrl: "",
      requireSignin: false,
    })).toBeNull()
  })

  test("resolves pasted install links", async () => {
    const configServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({
        clientName: "Linked Corp",
        webUrl: "https://linked.example.com/",
        apiUrl: "https://linked-api.example.com/",
        requireSignin: true,
        logoUrl: null,
        iconUrl: null,
        connectUrl: "openwork://connect?code=abcdefghijklmnopqrstuvwxyz123456&apiBaseUrl=https%3A%2F%2Flinked-api.example.com",
        connectExpiresAt: "2030-01-01T00:00:00.000Z",
        activationUrl: "https://linked.example.com/activate?code=abcdefghijklmnopqrstuvwxyz123456",
        activationExpiresAt: "2030-01-01T00:00:00.000Z",
      }),
    })
    try {
      const resolution = await resolveInstallerConfig({
        env: {},
        installLink: `http://127.0.0.1:${configServer.port}/install?token=abcDEF12`,
      })

      expect(resolution.source).toBe("install-link")
      expect(resolution.activation).toEqual({
        url: "https://linked.example.com/activate?code=abcdefghijklmnopqrstuvwxyz123456",
        expiresAt: "2030-01-01T00:00:00.000Z",
      })
      expect(resolution.installLink).toBe(`http://127.0.0.1:${configServer.port}/install?token=abcDEF12`)
      expect(resolution.config).toEqual({
        appName: "OpenWork",
        clientName: "Linked Corp",
        webUrl: "https://linked.example.com",
        apiUrl: "https://linked-api.example.com",
        requireSignin: true,
        logoUrl: null,
      })
    } finally {
      configServer.stop(true)
    }
  })
})

describe("install link helpers", () => {
  test("builds install config URLs", () => {
    expect(installConfigUrlFor("127.0.0.1:8790", "abcDEF12")).toBe("http://127.0.0.1:8790/v1/install-config?token=abcDEF12")
    expect(installConfigUrlFor("api.example.com", "abcDEF12")).toBe("https://api.example.com/v1/install-config?token=abcDEF12")
  })

  test("parses pasted install-link inputs", () => {
    expect(parseInstallLinkInput("https://app.example.com/install?token=abcDEF12")?.url).toBe(
      "https://app.example.com/api/den/v1/install-config?token=abcDEF12",
    )
    expect(parseInstallLinkInput("https://api.example.com/v1/install-config?token=abcDEF12")?.url).toBe(
      "https://api.example.com/v1/install-config?token=abcDEF12",
    )
    expect(parseInstallLinkInput("api.example.com abcDEF12")?.url).toBe(
      "https://api.example.com/v1/install-config?token=abcDEF12",
    )
    expect(parseInstallLinkInput("http://api.example.com/install?token=abcDEF12")).toBeNull()
  })
})

describe("system CA fetch", () => {
  test("classifies a default self-signed HTTPS install config as a TLS trust failure", async () => {
    const certificate = createSelfSignedCertificate()
    const configServer = startTlsInstallConfigServer(certificate)
    try {
      const result = await resolveInstallLinkConfig(`https://127.0.0.1:${configServer.port}/install?token=abcDEF12`)

      expect(result).toEqual({ status: "unreachable", reason: "tls" })
    } finally {
      configServer.stop(true)
      certificate.cleanup()
    }
  })

  test("resolves a self-signed HTTPS install config when the system CA loader supplies its certificate", async () => {
    const certificate = createSelfSignedCertificate()
    const configServer = startTlsInstallConfigServer(certificate)
    try {
      const result = await resolveInstallLinkConfig(`https://127.0.0.1:${configServer.port}/install?token=abcDEF12`, {
        fetcher: createSystemCaFetch(async () => [certificate.cert]),
      })

      expect(result).toEqual({
        status: "resolved",
        activation: null,
        config: {
          appName: "OpenWork",
          clientName: "TLS Corp",
          webUrl: "https://tls.example.com",
          apiUrl: "https://tls-api.example.com",
          requireSignin: true,
          logoUrl: null,
        },
      })
    } finally {
      configServer.stop(true)
      certificate.cleanup()
    }
  })

  test("parses darwin security PEM output", () => {
    const first = "-----BEGIN CERTIFICATE-----\nfirst\n-----END CERTIFICATE-----"
    const second = "-----BEGIN CERTIFICATE-----\nsecond\n-----END CERTIFICATE-----"

    expect(parseDarwinSecurityCertificates(`noise\n${first}\nmore noise\n${second}\n`)).toEqual([first, second])
  })

  test("parses and dedupes windows PowerShell certificate output", () => {
    const first = Buffer.from("first certificate with enough bytes to require PEM wrapping across more than one output line").toString("base64")
    const second = Buffer.from("second certificate").toString("base64")
    const output = [
      windowsPowerShellCertBlock(first),
      "noise",
      windowsPowerShellCertBlock(second),
      windowsPowerShellCertBlock(first),
    ].join("\n")

    expect(parseWindowsPowerShellCertificates(output)).toEqual([pemForBase64(first), pemForBase64(second)])
  })

  test("ignores garbage certificate command output", () => {
    expect(parseDarwinSecurityCertificates("not certificate output")).toEqual([])
    expect(parseWindowsPowerShellCertificates("not certificate output")).toEqual([])
  })

  test("passes through without TLS options when no system CAs are available", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("ok"),
    })
    try {
      const fetcher = createSystemCaFetch(async () => [])
      const response = await fetcher(`http://127.0.0.1:${server.port}/`)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe("ok")
    } finally {
      server.stop(true)
    }
  })
})

describe("OS trust store sources", () => {
  const CORPORATE_ROOT = "-----BEGIN CERTIFICATE-----\ncorporate-root\n-----END CERTIFICATE-----"
  const PUBLIC_ROOT = "-----BEGIN CERTIFICATE-----\npublic-root\n-----END CERTIFICATE-----"

  function loaders(overrides: Partial<SystemCaLoaders> = {}): SystemCaLoaders {
    return {
      runtime: () => [],
      platform: { name: "windows-cert-stores", load: async () => [] },
      extra: () => [],
      ...overrides,
    }
  }

  test("keeps enumerating the platform stores when the runtime already returned roots", async () => {
    // The shape of the failure on an inspected network: the runtime knows the
    // public roots, and only the platform store holds the corporate one.
    const bundle = await resolveSystemCaBundle(
      loaders({
        runtime: () => [PUBLIC_ROOT],
        platform: { name: "windows-cert-stores", load: async () => [CORPORATE_ROOT] },
      }),
    )

    expect(bundle.certificates).toEqual([PUBLIC_ROOT, CORPORATE_ROOT])
  })

  test("dedupes roots reported by more than one source", async () => {
    const bundle = await resolveSystemCaBundle(
      loaders({
        runtime: () => [PUBLIC_ROOT],
        platform: { name: "macos-keychains", load: async () => [PUBLIC_ROOT, CORPORATE_ROOT] },
        extra: () => [CORPORATE_ROOT],
      }),
    )

    expect(bundle.certificates).toEqual([PUBLIC_ROOT, CORPORATE_ROOT])
  })

  test("still contributes the other sources when platform enumeration fails", async () => {
    const bundle = await resolveSystemCaBundle(
      loaders({
        runtime: () => [PUBLIC_ROOT],
        platform: {
          name: "windows-cert-stores",
          load: async () => {
            throw new Error("powershell blocked by policy")
          },
        },
        extra: () => [CORPORATE_ROOT],
      }),
    )

    expect(bundle.certificates).toEqual([PUBLIC_ROOT, CORPORATE_ROOT])
  })

  test("reports what every source contributed so an empty bundle is explainable", async () => {
    const bundle = await resolveSystemCaBundle(
      loaders({ platform: { name: "windows-cert-stores", load: async () => [PUBLIC_ROOT] } }),
    )

    expect(summarizeSystemCaSources(bundle.sources)).toBe("runtime=0 windows-cert-stores=1 NODE_EXTRA_CA_CERTS=0")
  })

  test("reads every certificate out of a NODE_EXTRA_CA_CERTS bundle", () => {
    const bundlePath = path.join(mkdtempSync(path.join(os.tmpdir(), "ow-ca-")), "corporate.pem")
    writeFileSync(bundlePath, `# corporate bundle\n${CORPORATE_ROOT}\n${PUBLIC_ROOT}\n`)

    expect(loadExtraCaCertificates(bundlePath)).toEqual([CORPORATE_ROOT, PUBLIC_ROOT])
  })

  test("ignores an unset or unreadable NODE_EXTRA_CA_CERTS instead of failing the install", () => {
    const previous = process.env.NODE_EXTRA_CA_CERTS
    delete process.env.NODE_EXTRA_CA_CERTS
    try {
      expect(loadExtraCaCertificates()).toEqual([])
      expect(loadExtraCaCertificates("   ")).toEqual([])
      expect(loadExtraCaCertificates(path.join(os.tmpdir(), "ow-ca-does-not-exist.pem"))).toEqual([])
    } finally {
      if (previous !== undefined) process.env.NODE_EXTRA_CA_CERTS = previous
    }
  })

  test("leaves the user-writable login keychain out of the trusted set", () => {
    // `security find-certificate` ignores trust settings, so enumerating a
    // keychain any local process can write to would widen what we trust.
    expect(DARWIN_KEYCHAINS.some((keychain) => keychain.includes("login.keychain"))).toBe(false)
    expect(DARWIN_KEYCHAINS).toContain("/Library/Keychains/System.keychain")
  })

  test("a corporate root supplied only through NODE_EXTRA_CA_CERTS resolves a real TLS install link", async () => {
    const certificate = createSelfSignedCertificate()
    const configServer = startTlsInstallConfigServer(certificate)
    const bundlePath = path.join(mkdtempSync(path.join(os.tmpdir(), "ow-ca-")), "corporate.pem")
    writeFileSync(bundlePath, certificate.cert)
    try {
      const bundle = await resolveSystemCaBundle(loaders({ extra: () => loadExtraCaCertificates(bundlePath) }))
      const result = await resolveInstallLinkConfig(`https://127.0.0.1:${configServer.port}/install?token=abcDEF12`, {
        fetcher: createSystemCaFetch(async () => bundle.certificates),
      })

      expect(result.status).toBe("resolved")
    } finally {
      configServer.stop(true)
      certificate.cleanup()
    }
  })
})

describe("resolve-link API", () => {
  test("explains pasted GitHub artifact URLs are not install links", async () => {
    const installerServer = startInstallerServer(null, () => undefined)
    try {
      const response = await fetch(`${installerServer.url}api/resolve-link`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-installer-token": installerServer.token },
        body: JSON.stringify({ installLink: "https://github.com/different-ai/openwork/releases/download/v0.17.39/OpenWork-Installer-win-x64.exe" }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: "install_link_invalid",
        message: "That doesn't look like an install link. On your team's install page, copy the link shown in step 2 — it ends with ?token=...",
      })
    } finally {
      installerServer.stop()
    }
  })

  test("explains unreachable workspaces as connection or VPN problems", async () => {
    const configServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ ok: true }),
    })
    const port = configServer.port
    const installerServer = startInstallerServer(null, () => undefined)
    configServer.stop(true)
    try {
      const response = await fetch(`${installerServer.url}api/resolve-link`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-installer-token": installerServer.token },
        body: JSON.stringify({ installLink: `http://127.0.0.1:${port}/install?token=abcDEF12` }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: "install_link_unreachable",
        message: "Could not reach your workspace. Check your internet or VPN connection and try again.",
      })
    } finally {
      installerServer.stop()
    }
  })

  test("explains TLS trust failures separately from network reachability", async () => {
    const certificate = createSelfSignedCertificate()
    const configServer = startTlsInstallConfigServer(certificate)
    const installerServer = startInstallerServer(null, () => undefined)
    try {
      const response = await fetch(`${installerServer.url}api/resolve-link`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-installer-token": installerServer.token },
        body: JSON.stringify({ installLink: `https://127.0.0.1:${configServer.port}/install?token=abcDEF12` }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: "install_link_tls_untrusted",
        // Carried alongside the user-facing copy so a support screenshot shows
        // whether the trust stores were even readable.
        trustSources: expect.stringContaining("runtime="),
        message: `Reached your workspace, but the secure connection isn't trusted on this computer yet. This usually means your company inspects secure traffic. Try again — if it keeps failing, ask IT to check the certificate for 127.0.0.1:${configServer.port}.`,
      })
    } finally {
      installerServer.stop()
      configServer.stop(true)
      certificate.cleanup()
    }
  })

  test("maps missing install configs to the expired-link message", async () => {
    const configServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("missing", { status: 404, statusText: "Not Found" }),
    })
    const installerServer = startInstallerServer(null, () => undefined)
    try {
      const response = await fetch(`${installerServer.url}api/resolve-link`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-installer-token": installerServer.token },
        body: JSON.stringify({ installLink: `http://127.0.0.1:${configServer.port}/install?token=abcDEF12` }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: "install_link_expired",
        message: "This install link has expired or was replaced. Ask your workspace admin for a fresh one from the Members page.",
      })
    } finally {
      installerServer.stop()
      configServer.stop(true)
    }
  })

  test("keeps generic copy for other install config failures", async () => {
    const configServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("error", { status: 500, statusText: "Internal Server Error" }),
    })
    const installerServer = startInstallerServer(null, () => undefined)
    try {
      const response = await fetch(`${installerServer.url}api/resolve-link`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-installer-token": installerServer.token },
        body: JSON.stringify({ installLink: `http://127.0.0.1:${configServer.port}/install?token=abcDEF12` }),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: "install_link_invalid",
        message: "Install link could not be resolved.",
      })
    } finally {
      installerServer.stop()
      configServer.stop(true)
    }
  })
})

describe("browser activation API", () => {
  test("keeps a copyable link when the operating system cannot open the browser", async () => {
    const openedUrls: string[] = []
    const activationUrl = "https://den.example.test/activate?code=abcdefghijklmnopqrstuvwxyz123456"
    const installerServer = startInstallerServer({
      config: {
        appName: "OpenWork",
        clientName: "Acme Robotics",
        webUrl: "https://den.example.test",
        apiUrl: "https://api.den.example.test",
        logoUrl: null,
        requireSignin: true,
      },
      source: "install-link",
      activation: {
        url: activationUrl,
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
      installLink: null,
    }, () => undefined, (url) => {
      openedUrls.push(url)
      return Promise.resolve(false)
    })

    try {
      const response = await fetch(`${installerServer.url}api/open-activation`, {
        method: "POST",
        headers: { "x-installer-token": installerServer.token },
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        opened: false,
        activationUrl,
        expiresAt: "2030-01-01T00:00:00.000Z",
      })
      expect(openedUrls).toEqual([activationUrl])

      const fallback = await fetch(`${installerServer.url}api/activation`, {
        method: "POST",
        headers: { "x-installer-token": installerServer.token },
      })
      expect(fallback.status).toBe(200)
      await expect(fallback.json()).resolves.toEqual({
        activationUrl,
        expiresAt: "2030-01-01T00:00:00.000Z",
      })
    } finally {
      installerServer.stop()
    }
  })
})

describe("writeBootstrapConfig", () => {
  test("migrates a legacy organization config instead of replacing it with hosted defaults", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openwork-installer-test-"))
    const env = {
      LOCALAPPDATA: path.join(dir, "LocalAppData"),
      USERPROFILE: path.join(dir, "profile"),
    }
    const target = desktopBootstrapPath(env, "win32")
    const legacy = legacyDesktopBootstrapPath(env, "win32")
    try {
      mkdirSync(path.dirname(target), { recursive: true })
      mkdirSync(path.dirname(legacy), { recursive: true })
      writeFileSync(target, JSON.stringify({
        baseUrl: "https://app.openworklabs.com/api/den/",
        writtenAt: "2026-07-10T13:00:00.000Z",
      }))
      writeFileSync(legacy, JSON.stringify({
        baseUrl: "https://openwork.organization.internal.example",
        apiBaseUrl: "https://api.organization.internal.example",
        handoff: { grant: "drop-me" },
        prepared: { orgId: "org_example" },
        claimLinks: [{ id: "claim_example" }],
        writtenAt: "2026-07-09T12:00:00.000Z",
      }))
      const written = writeBootstrapConfig(
        { appName: "OpenWork", clientName: "Hosted", webUrl: "https://app.openworklabs.com/", apiUrl: "https://api.openworklabs.com/", requireSignin: false, logoUrl: null },
        env,
        "win32",
      )
      expect(written).toBe(target)
      const parsed = JSON.parse(readFileSync(target, "utf8"))
      expect(parsed.baseUrl).toBe("https://openwork.organization.internal.example")
      expect(parsed.apiBaseUrl).toBe("https://api.organization.internal.example")
      expect(parsed.handoff).toBeUndefined()
      expect(parsed.prepared).toEqual({ orgId: "org_example" })
      expect(parsed.claimLinks).toEqual([{ id: "claim_example" }])
      expect(Number.isFinite(Date.parse(parsed.writtenAt))).toBe(true)
      expect(existsSync(legacy)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("keeps a canonical organization config across repeated hosted reinstalls", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openwork-installer-test-"))
    const env = {
      LOCALAPPDATA: path.join(dir, "LocalAppData"),
      USERPROFILE: path.join(dir, "profile"),
    }
    const target = desktopBootstrapPath(env, "win32")
    try {
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, JSON.stringify({
        baseUrl: "https://openwork.organization.internal.example",
        apiBaseUrl: "https://api.organization.internal.example",
        handoff: { grant: "drop-me" },
        prepared: { orgId: "org_example" },
        claimLinks: [{ id: "claim_example" }],
      }))
      const hostedConfig = {
        appName: "OpenWork",
        clientName: "Hosted",
        webUrl: "https://api.openworklabs.com/v1/",
        apiUrl: "https://api.openworklabs.com/",
        requireSignin: false,
        logoUrl: null,
      }

      writeBootstrapConfig(hostedConfig, env, "win32")
      writeBootstrapConfig(hostedConfig, env, "win32")

      const parsed = JSON.parse(readFileSync(target, "utf8"))
      expect(parsed.baseUrl).toBe("https://openwork.organization.internal.example")
      expect(parsed.apiBaseUrl).toBe("https://api.organization.internal.example")
      expect(parsed.handoff).toBeUndefined()
      expect(parsed.prepared).toEqual({ orgId: "org_example" })
      expect(parsed.claimLinks).toEqual([{ id: "claim_example" }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("replaces an installed hosted default with a custom organization config", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openwork-installer-test-"))
    const env = {
      LOCALAPPDATA: path.join(dir, "LocalAppData"),
      USERPROFILE: path.join(dir, "profile"),
    }
    const target = desktopBootstrapPath(env, "win32")
    try {
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, JSON.stringify({
        baseUrl: "https://app.openworklabs.com/api/den/",
        apiBaseUrl: "https://api.openworklabs.com/",
        prepared: { orgId: "org_example" },
        claimLinks: [{ id: "claim_example" }],
      }))

      writeBootstrapConfig(
        {
          appName: "Example Org Work",
          clientName: "Example Org",
          webUrl: "https://openwork.custom.internal.example",
          apiUrl: "https://api.custom.internal.example",
          requireSignin: true,
          logoUrl: "https://openwork.custom.internal.example/assets/wordmark.svg",
        },
        env,
        "win32",
      )

      const parsed = JSON.parse(readFileSync(target, "utf8"))
      expect(parsed.baseUrl).toBe("https://openwork.custom.internal.example")
      expect(parsed.apiBaseUrl).toBe("https://api.custom.internal.example")
      expect(parsed.requireSignin).toBe(true)
      expect(parsed.brandAppName).toBe("Example Org Work")
      expect(parsed.brandLogoUrl).toBe("https://openwork.custom.internal.example/assets/wordmark.svg")
      expect(parsed.prepared).toEqual({ orgId: "org_example" })
      expect(parsed.claimLinks).toEqual([{ id: "claim_example" }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("removableInstallerBundlePath", () => {
  const homeDir = "/Users/example"
  const executablePath = "Contents/MacOS/openwork-installer"

  test("allows only the installer app bundle in common writable locations", () => {
    expect(removableInstallerBundlePath(`/Applications/Install OpenWork.app/${executablePath}`, homeDir, "darwin")).toBe(
      "/Applications/Install OpenWork.app",
    )
    expect(removableInstallerBundlePath(`${homeDir}/Applications/Install OpenWork.app/${executablePath}`, homeDir, "darwin")).toBe(
      `${homeDir}/Applications/Install OpenWork.app`,
    )
    expect(removableInstallerBundlePath(`${homeDir}/Downloads/Install OpenWork.app/${executablePath}`, homeDir, "darwin")).toBe(
      `${homeDir}/Downloads/Install OpenWork.app`,
    )
  })

  test("rejects DMG mounts, wrong app names, nested copies, and other platforms", () => {
    expect(removableInstallerBundlePath(`/Volumes/Install OpenWork/Install OpenWork.app/${executablePath}`, homeDir, "darwin")).toBeNull()
    expect(removableInstallerBundlePath(`/Applications/OpenWork.app/${executablePath}`, homeDir, "darwin")).toBeNull()
    expect(removableInstallerBundlePath(`${homeDir}/Downloads/OpenWork/Install OpenWork.app/${executablePath}`, homeDir, "darwin")).toBeNull()
    expect(removableInstallerBundlePath(`/Applications/Install OpenWork.app/${executablePath}`, homeDir, "linux")).toBeNull()
  })
})
