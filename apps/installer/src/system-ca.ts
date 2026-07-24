import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import tls from "node:tls"

// Enterprise TLS interception can be trusted by the browser/OS while Bun fetch
// only sees bundled roots. Mirror desktop runtime.mjs resolveSystemCaEnv by
// extending Bun fetch with best-effort OS trust-store CAs.

type SystemCaTlsModule = {
  getCACertificates?: (type?: string) => string[]
}

export type TlsFetchInit = RequestInit & { tls?: { ca?: string[] } }

const COMMAND_TIMEOUT_MS = 10_000
const OUTPUT_LIMIT_CHARS = 8 * 1024 * 1024
const WINDOWS_CERT_BEGIN = "-----OPENWORK-CERTIFICATE-----"
const WINDOWS_CERT_END = "-----END-OPENWORK-CERTIFICATE-----"
const PEM_CERT_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
const TLS_SYSTEM_MODULE: SystemCaTlsModule = tls

let systemCaCertificatesPromise: Promise<SystemCaBundle> | null = null

function dedupeCertificates(certs: Iterable<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const cert of certs) {
    const trimmed = cert.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function pemFromBase64(value: string): string | null {
  const base64 = value.replace(/\s+/g, "")
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return null
  }
  const lines = base64.match(/.{1,64}/g)
  if (!lines) return null
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`
}

export function parseWindowsPowerShellCertificates(output: string): string[] {
  const certs: string[] = []
  const pattern = new RegExp(`${WINDOWS_CERT_BEGIN}\\s*([A-Za-z0-9+/=\\r\\n]+?)\\s*${WINDOWS_CERT_END}`, "g")
  for (const match of output.matchAll(pattern)) {
    const pem = pemFromBase64(match[1] ?? "")
    if (pem) certs.push(pem)
  }
  return dedupeCertificates(certs)
}

export function parseDarwinSecurityCertificates(output: string): string[] {
  const certs: string[] = []
  for (const match of output.matchAll(PEM_CERT_PATTERN)) {
    certs.push(match[0])
  }
  return dedupeCertificates(certs)
}

function runCommand(command: string, args: string[], windowsHide: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide })
    } catch {
      resolve(null)
      return
    }

    let output = ""
    let settled = false
    const timeout = setTimeout(() => {
      child.kill()
      finish(null)
    }, COMMAND_TIMEOUT_MS)

    function finish(value: string | null) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }

    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk) => {
      if (settled) return
      const next = `${output}${String(chunk)}`
      if (next.length > OUTPUT_LIMIT_CHARS) {
        child.kill()
        finish(null)
        return
      }
      output = next
    })
    child.on("error", () => finish(null))
    child.on("exit", (code) => finish(code === 0 ? output : null))
  })
}

function loadNodeSystemCertificates(): string[] {
  try {
    if (typeof TLS_SYSTEM_MODULE.getCACertificates !== "function") return []
    return dedupeCertificates(TLS_SYSTEM_MODULE.getCACertificates("system"))
  } catch {
    return []
  }
}

async function loadWindowsSystemCertificates(): Promise<string[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$stores = @('Cert:\\LocalMachine\\Root', 'Cert:\\LocalMachine\\CA', 'Cert:\\CurrentUser\\Root', 'Cert:\\CurrentUser\\CA')
foreach ($store in $stores) {
  Get-ChildItem -Path $store -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.RawData) {
      '${WINDOWS_CERT_BEGIN}'
      [Convert]::ToBase64String($_.RawData)
      '${WINDOWS_CERT_END}'
    }
  }
}
`
  const output = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], true)
  return output ? parseWindowsPowerShellCertificates(output) : []
}

// Admin-controlled keychains only. `find-certificate` ignores trust settings, so
// including the user-writable login keychain would let any local process widen
// what the installer trusts; user-domain roots go through NODE_EXTRA_CA_CERTS.
export const DARWIN_KEYCHAINS = [
  "/Library/Keychains/System.keychain",
  "/System/Library/Keychains/SystemRootCertificates.keychain",
]

async function loadDarwinSystemCertificates(): Promise<string[]> {
  const output = await runCommand("security", ["find-certificate", "-a", "-p", ...DARWIN_KEYCHAINS], false)
  return output ? parseDarwinSecurityCertificates(output) : []
}

/**
 * The documented escape hatch. IT can always point the installer at a PEM
 * bundle, matching what the desktop shell already honors and giving locked-down
 * fleets a deterministic override when store enumeration comes up short.
 */
export function loadExtraCaCertificates(
  filePath: string | undefined = process.env.NODE_EXTRA_CA_CERTS,
): string[] {
  const trimmed = filePath?.trim()
  if (!trimmed) return []
  try {
    return dedupeCertificates(readFileSync(trimmed, "utf8").match(PEM_CERT_PATTERN) ?? [])
  } catch {
    return []
  }
}

export type SystemCaSource = { name: string; count: number }

export type SystemCaBundle = {
  certificates: string[]
  sources: SystemCaSource[]
}

export function summarizeSystemCaSources(sources: SystemCaSource[]): string {
  if (sources.length === 0) return "no OS trust sources returned certificates"
  return sources.map((source) => `${source.name}=${source.count}`).join(" ")
}

function platformCertificateLoader(): { name: string; load: () => Promise<string[]> } {
  if (process.platform === "win32") return { name: "windows-cert-stores", load: loadWindowsSystemCertificates }
  if (process.platform === "darwin") return { name: "macos-keychains", load: loadDarwinSystemCertificates }
  return { name: "platform-stores", load: async () => [] }
}

export type SystemCaLoaders = {
  runtime: () => string[]
  platform: { name: string; load: () => Promise<string[]> }
  extra: () => string[]
}

/**
 * Every source is additive. Returning the runtime list as soon as it was
 * non-empty skipped the thorough platform enumeration, so a runtime that
 * reports a partial set of roots — the case on an inspected network — never
 * got the corporate CA it was missing.
 */
export async function resolveSystemCaBundle(loaders: SystemCaLoaders): Promise<SystemCaBundle> {
  const runtimeCerts = loaders.runtime()
  const platformCerts = await loaders.platform.load().catch(() => [])
  const extraCerts = loaders.extra()

  return {
    certificates: dedupeCertificates([...runtimeCerts, ...platformCerts, ...extraCerts]),
    sources: [
      { name: "runtime", count: runtimeCerts.length },
      { name: loaders.platform.name, count: platformCerts.length },
      { name: "NODE_EXTRA_CA_CERTS", count: extraCerts.length },
    ],
  }
}

export async function loadSystemCaBundle(): Promise<SystemCaBundle> {
  systemCaCertificatesPromise ??= resolveSystemCaBundle({
    runtime: loadNodeSystemCertificates,
    platform: platformCertificateLoader(),
    extra: loadExtraCaCertificates,
  })
  return await systemCaCertificatesPromise
}

export async function loadSystemCaCertificates(): Promise<string[]> {
  return (await loadSystemCaBundle()).certificates
}

function mergeFetchInitWithCa(init: TlsFetchInit | undefined, ca: string[]): TlsFetchInit {
  const callerCa = init?.tls?.ca
  const mergedCa = callerCa ? dedupeCertificates([...callerCa, ...ca]) : ca
  if (init?.tls) {
    return { ...init, tls: { ...init.tls, ca: mergedCa } }
  }
  return { ...init, tls: { ca: mergedCa } }
}

export function createSystemCaFetch(loadCertificates: () => Promise<string[]>): typeof fetch {
  return async function systemCaFetch(input: RequestInfo | URL, init?: TlsFetchInit): Promise<Response> {
    const ca = await loadCertificates().catch(() => [])
    if (ca.length === 0) return fetch(input, init)
    return fetch(input, mergeFetchInitWithCa(init, ca))
  }
}

export const fetchWithSystemCa = createSystemCaFetch(loadSystemCaCertificates)
