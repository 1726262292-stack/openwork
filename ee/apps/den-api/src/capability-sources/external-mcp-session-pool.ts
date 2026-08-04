import { createHash } from "node:crypto"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { env } from "../env.js"
import {
  readConnectedAccountForExternalMcpIdentity,
  type ExternalMcpConnectionRow,
} from "./external-mcp-connections.js"
import type { ExternalMcpDiagnosticTracker } from "./external-mcp-diagnostics.js"
import type { ExternalMcpToolCallInspector } from "./external-mcp-tool-inspection.js"
import type { ExternalMcpLifecycleDeadline, ExternalMcpMemberContext } from "./external-mcp-client.js"

const DEFAULT_IDLE_TTL_MS = 120_000
const DEFAULT_ABSOLUTE_TTL_MS = 10 * 60_000
const DEFAULT_MAX_ENTRIES = 64
const DEFAULT_BUSY_WAIT_MS = 2_000

export type ExternalMcpSessionPoolKey = {
  id: string
  connectionId: string
  memberKey?: string
}

export type ExternalMcpSessionLeaseContext = {
  deadline: ExternalMcpLifecycleDeadline
  diagnostic: ExternalMcpDiagnosticTracker
  toolCallInspector?: ExternalMcpToolCallInspector
}

export type ExternalMcpSessionLeaseSlot = {
  current: ExternalMcpSessionLeaseContext | null
}

type ExternalMcpSessionPoolEntry = {
  client: Client
  transport: StreamableHTTPClientTransport
  leaseSlot: ExternalMcpSessionLeaseSlot
  lastUsedAt: number
  createdAt: number
  key: string
  connectionId: string
  memberKey?: string
  releaseWaiters: Set<() => void>
}

export type ExternalMcpSessionFactory = (
  leaseSlot: ExternalMcpSessionLeaseSlot,
) => Promise<{
  client: Client
  transport: StreamableHTTPClientTransport
}>

export type ExternalMcpSessionLease = {
  client: Client
  transport: StreamableHTTPClientTransport
  reused: boolean
  pooled: boolean
  release: () => Promise<void>
  evict: () => Promise<void>
}

type TestOverrides = {
  now?: () => number
  idleTtlMs?: number
  absoluteTtlMs?: number
  maxEntries?: number
  enabled?: boolean
  busyWaitMs?: number
}

let testOverrides: TestOverrides | null = null
const entries = new Map<string, ExternalMcpSessionPoolEntry>()
const pendingEntries = new Map<string, Promise<ExternalMcpSessionPoolEntry>>()

function optionValue<T>(override: T | undefined, fallback: T): T {
  return override === undefined ? fallback : override
}

function nowMs(): number {
  return testOverrides?.now?.() ?? Date.now()
}

function idleTtlMs(): number {
  return optionValue(testOverrides?.idleTtlMs, DEFAULT_IDLE_TTL_MS)
}

function absoluteTtlMs(): number {
  return optionValue(testOverrides?.absoluteTtlMs, DEFAULT_ABSOLUTE_TTL_MS)
}

function maxEntries(): number {
  return optionValue(testOverrides?.maxEntries, DEFAULT_MAX_ENTRIES)
}

function busyWaitMs(): number {
  return optionValue(testOverrides?.busyWaitMs, DEFAULT_BUSY_WAIT_MS)
}

function sessionReuseEnabled(): boolean {
  return optionValue(testOverrides?.enabled, env.externalMcpSessionReuseEnabled)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export async function buildExternalMcpSessionPoolKey(input: {
  connection: ExternalMcpConnectionRow
  member?: ExternalMcpMemberContext
}): Promise<ExternalMcpSessionPoolKey> {
  const memberKey = input.connection.credentialMode === "per_member"
    ? input.member?.orgMembershipId
    : undefined
  if (input.connection.credentialMode === "per_member" && !memberKey) {
    throw new Error(`Connection "${input.connection.id}" uses per-member credentials; a member context is required.`)
  }
  const connectedAccount = input.connection.credentialMode === "per_member" && input.connection.authType === "oauth" && memberKey
    ? await readConnectedAccountForExternalMcpIdentity({
        connection: input.connection,
        orgMembershipId: memberKey,
      })
    : null
  if (connectedAccount && !connectedAccount.current) {
    throw new Error("The external MCP connection identity changed before a session key could be derived.")
  }
  const memberCredentialRevision = connectedAccount?.value
    ? `${connectedAccount.value.id}:${connectedAccount.value.updatedAt.toISOString()}`
    : null
  const fingerprint = JSON.stringify({
    connectionId: input.connection.id,
    url: input.connection.url,
    authType: input.connection.authType,
    credentialMode: input.connection.credentialMode,
    apiKeyHash: input.connection.apiKey ? sha256(input.connection.apiKey) : null,
    oauthConfigurationHash: input.connection.oauthConfiguration
      ? sha256(JSON.stringify(input.connection.oauthConfiguration))
      : null,
    connectionUpdatedAt: input.connection.updatedAt.toISOString(),
    memberKey: memberKey ?? null,
    memberCredentialRevision,
  })
  return {
    id: sha256(fingerprint),
    connectionId: input.connection.id,
    ...(memberKey ? { memberKey } : {}),
  }
}

function entryExpired(entry: ExternalMcpSessionPoolEntry, now: number): boolean {
  return now - entry.lastUsedAt > idleTtlMs() || now - entry.createdAt > absoluteTtlMs()
}

async function closeEntry(entry: ExternalMcpSessionPoolEntry): Promise<void> {
  try {
    await entry.client.close()
  } catch {
    // Eviction is best-effort; callers keep the causal operation diagnostic.
  }
}

async function evictEntry(entry: ExternalMcpSessionPoolEntry): Promise<void> {
  if (entries.get(entry.key) === entry) entries.delete(entry.key)
  for (const notify of entry.releaseWaiters) notify()
  entry.releaseWaiters.clear()
  await closeEntry(entry)
}

async function sweepExpiredEntries(now: number): Promise<void> {
  const expired: ExternalMcpSessionPoolEntry[] = []
  for (const entry of entries.values()) {
    if (entryExpired(entry, now)) expired.push(entry)
  }
  await Promise.all(expired.map((entry) => evictEntry(entry)))
}

async function evictLruIdleEntry(): Promise<boolean> {
  let lru: ExternalMcpSessionPoolEntry | null = null
  for (const entry of entries.values()) {
    if (entry.leaseSlot.current) continue
    if (!lru || entry.lastUsedAt < lru.lastUsedAt) lru = entry
  }
  if (!lru) return false
  await evictEntry(lru)
  return true
}

async function makeEntry(input: {
  key: ExternalMcpSessionPoolKey
  lease: ExternalMcpSessionLeaseContext
  factory: ExternalMcpSessionFactory
}): Promise<ExternalMcpSessionPoolEntry> {
  const leaseSlot: ExternalMcpSessionLeaseSlot = { current: input.lease }
  const session = await input.factory(leaseSlot)
  const now = nowMs()
  return {
    client: session.client,
    transport: session.transport,
    leaseSlot,
    lastUsedAt: now,
    createdAt: now,
    key: input.key.id,
    connectionId: input.key.connectionId,
    ...(input.key.memberKey ? { memberKey: input.key.memberKey } : {}),
    releaseWaiters: new Set(),
  }
}

function leasePooledEntry(input: {
  entry: ExternalMcpSessionPoolEntry
  lease: ExternalMcpSessionLeaseContext
  reused: boolean
}): ExternalMcpSessionLease {
  input.entry.leaseSlot.current = input.lease
  input.entry.lastUsedAt = nowMs()
  return {
    client: input.entry.client,
    transport: input.entry.transport,
    reused: input.reused,
    pooled: true,
    release: async () => {
      if (input.entry.leaseSlot.current === input.lease) input.entry.leaseSlot.current = null
      input.entry.lastUsedAt = nowMs()
      for (const notify of input.entry.releaseWaiters) notify()
      input.entry.releaseWaiters.clear()
    },
    evict: () => evictEntry(input.entry),
  }
}

async function leaseEphemeralSession(input: {
  key: ExternalMcpSessionPoolKey
  lease: ExternalMcpSessionLeaseContext
  factory: ExternalMcpSessionFactory
}): Promise<ExternalMcpSessionLease> {
  const entry = await makeEntry(input)
  return {
    client: entry.client,
    transport: entry.transport,
    reused: false,
    pooled: false,
    release: async () => {
      try {
        await entry.client.close()
      } finally {
        entry.leaseSlot.current = null
      }
    },
    evict: () => closeEntry(entry),
  }
}

async function waitForRelease(entry: ExternalMcpSessionPoolEntry): Promise<boolean> {
  if (!entry.leaseSlot.current) return true
  const waitMs = busyWaitMs()
  if (waitMs <= 0) return false
  return await new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      entry.releaseWaiters.delete(onRelease)
      resolve(value)
    }
    const onRelease = () => finish(true)
    const timer = setTimeout(() => finish(false), waitMs)
    entry.releaseWaiters.add(onRelease)
  })
}

export async function acquireExternalMcpSession(input: {
  key: ExternalMcpSessionPoolKey
  lease: ExternalMcpSessionLeaseContext
  factory: ExternalMcpSessionFactory
  fresh?: boolean
}): Promise<ExternalMcpSessionLease> {
  if (!sessionReuseEnabled()) return leaseEphemeralSession(input)

  const now = nowMs()
  await sweepExpiredEntries(now)

  const existing = entries.get(input.key.id)
  if (input.fresh && existing) {
    await evictEntry(existing)
  } else if (existing && !entryExpired(existing, now)) {
    if (!existing.leaseSlot.current) return leasePooledEntry({ entry: existing, lease: input.lease, reused: true })
    // One pooled session is leased exclusively. A concurrent same-key request
    // waits briefly for the lease, then falls back to a throwaway session so a
    // long-running prompt cannot head-of-line block the caller indefinitely.
    if (await waitForRelease(existing)) {
      const current = entries.get(input.key.id)
      if (current === existing && !existing.leaseSlot.current && !entryExpired(existing, nowMs())) {
        return leasePooledEntry({ entry: existing, lease: input.lease, reused: true })
      }
    }
    return leaseEphemeralSession(input)
  } else if (existing) {
    await evictEntry(existing)
  }

  const pending = input.fresh ? undefined : pendingEntries.get(input.key.id)
  if (pending) {
    const entry = await pending
    if (!entryExpired(entry, nowMs())) {
      if (!entry.leaseSlot.current) return leasePooledEntry({ entry, lease: input.lease, reused: true })
      if (await waitForRelease(entry)) {
        const current = entries.get(input.key.id)
        if (current === entry && !entry.leaseSlot.current && !entryExpired(entry, nowMs())) {
          return leasePooledEntry({ entry, lease: input.lease, reused: true })
        }
      }
    }
    return leaseEphemeralSession(input)
  }

  if (entries.size >= maxEntries() && !await evictLruIdleEntry()) {
    return leaseEphemeralSession(input)
  }

  const created = makeEntry(input)
  pendingEntries.set(input.key.id, created)
  try {
    const entry = await created
    entries.set(input.key.id, entry)
    return leasePooledEntry({ entry, lease: input.lease, reused: false })
  } finally {
    pendingEntries.delete(input.key.id)
  }
}

export async function invalidateExternalMcpSessions(connectionId: string, memberKey?: string): Promise<void> {
  const matches: ExternalMcpSessionPoolEntry[] = []
  for (const entry of entries.values()) {
    if (entry.connectionId !== connectionId) continue
    if (memberKey && entry.memberKey !== memberKey) continue
    matches.push(entry)
  }
  await Promise.all(matches.map((entry) => evictEntry(entry)))
}

export async function resetExternalMcpSessionPoolForTests(): Promise<void> {
  await Promise.all([...entries.values()].map((entry) => evictEntry(entry)))
  pendingEntries.clear()
  entries.clear()
  testOverrides = null
}

export function configureExternalMcpSessionPoolForTests(overrides: TestOverrides | null): void {
  testOverrides = overrides
}
