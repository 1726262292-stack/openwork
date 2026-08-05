import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

export type ResolvedAddress = {
  address: string
}

export type ResolveHostname = (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>

const blockedAddresses = new BlockList()
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4")
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4")
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4")
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4")
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4")
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4")
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4")
blockedAddresses.addSubnet("198.18.0.0", 15, "ipv4")
blockedAddresses.addSubnet("224.0.0.0", 4, "ipv4")
blockedAddresses.addAddress("::", "ipv6")
blockedAddresses.addAddress("::1", "ipv6")
blockedAddresses.addSubnet("fc00::", 7, "ipv6")
blockedAddresses.addSubnet("fe80::", 10, "ipv6")
blockedAddresses.addSubnet("fec0::", 10, "ipv6")
blockedAddresses.addSubnet("ff00::", 8, "ipv6")
blockedAddresses.addSubnet("::ffff:0.0.0.0", 104, "ipv6")
blockedAddresses.addSubnet("::ffff:10.0.0.0", 104, "ipv6")
blockedAddresses.addSubnet("::ffff:100.64.0.0", 106, "ipv6")
blockedAddresses.addSubnet("::ffff:127.0.0.0", 104, "ipv6")
blockedAddresses.addSubnet("::ffff:169.254.0.0", 112, "ipv6")
blockedAddresses.addSubnet("::ffff:172.16.0.0", 108, "ipv6")
blockedAddresses.addSubnet("::ffff:192.168.0.0", 112, "ipv6")
blockedAddresses.addSubnet("::ffff:198.18.0.0", 111, "ipv6")
blockedAddresses.addSubnet("::ffff:224.0.0.0", 100, "ipv6")

const loopbackAddresses = new BlockList()
loopbackAddresses.addSubnet("127.0.0.0", 8, "ipv4")
loopbackAddresses.addAddress("::1", "ipv6")

function normalizedHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "")
}

function isBlockedHostname(hostname: string) {
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "metadata.google.internal"
    || hostname.endsWith(".metadata.google.internal")
}

function isBlockedAddress(address: string) {
  const version = isIP(address)
  if (version === 4) return blockedAddresses.check(address, "ipv4")
  if (version === 6) return blockedAddresses.check(address, "ipv6")
  return true
}

function isLoopbackHostname(hostname: string) {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true
  const version = isIP(hostname)
  if (version === 4) return loopbackAddresses.check(hostname, "ipv4")
  if (version === 6) return loopbackAddresses.check(hostname, "ipv6")
  return false
}

export const resolveHostname: ResolveHostname = (hostname) => lookup(hostname, {
  all: true,
  verbatim: true,
})

export async function isAllowedByoUpstream(input: {
  rawUrl: string
  allowInsecureLoopback: boolean
  resolveHostname: ResolveHostname
}) {
  let url: URL
  try {
    url = new URL(input.rawUrl)
  } catch {
    return false
  }

  if (url.username || url.password) return false
  const hostname = normalizedHostname(url.hostname)
  if (
    url.protocol === "http:"
    && input.allowInsecureLoopback
    && isLoopbackHostname(hostname)
  ) {
    return true
  }
  if (url.protocol !== "https:" || isBlockedHostname(hostname)) return false

  if (isIP(hostname)) return !isBlockedAddress(hostname)

  let addresses: ReadonlyArray<ResolvedAddress>
  try {
    addresses = await input.resolveHostname(hostname)
  } catch {
    return false
  }
  return addresses.length > 0 && addresses.every(({ address }) => !isBlockedAddress(address))
}
