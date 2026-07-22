import { WorkspaceCursorEventStore } from "./cursor-event-store.js";
import type { TokenScope } from "./types.js";
import { shortId } from "./utils.js";

export type FileSessionEventType = "write" | "delete" | "rename" | "mkdir";

export type FileSessionEvent = {
  id: string;
  seq: number;
  workspaceId: string;
  type: FileSessionEventType;
  path: string;
  toPath?: string;
  revision?: string;
  timestamp: number;
};

export type FileSessionRecord = {
  id: string;
  workspaceId: string;
  workspaceRoot: string;
  actorTokenHash: string;
  actorScope: TokenScope;
  canWrite: boolean;
  createdAt: number;
  expiresAt: number;
};

export class FileSessionStore {
  private sessions = new Map<string, FileSessionRecord>();

  private workspaceEvents: WorkspaceCursorEventStore<FileSessionEvent>;

  private maxSessions: number;

  constructor(options?: { maxSessions?: number; maxEventsPerWorkspace?: number }) {
    this.maxSessions = options?.maxSessions ?? 256;
    this.workspaceEvents = new WorkspaceCursorEventStore(options?.maxEventsPerWorkspace ?? 500);
  }

  create(input: {
    workspaceId: string;
    workspaceRoot: string;
    actorTokenHash: string;
    actorScope: TokenScope;
    canWrite: boolean;
    ttlMs: number;
  }): FileSessionRecord {
    this.pruneExpired();
    this.evictIfNeeded();

    const now = Date.now();
    const record: FileSessionRecord = {
      id: shortId(),
      workspaceId: input.workspaceId,
      workspaceRoot: input.workspaceRoot,
      actorTokenHash: input.actorTokenHash,
      actorScope: input.actorScope,
      canWrite: input.canWrite,
      createdAt: now,
      expiresAt: now + input.ttlMs,
    };
    this.sessions.set(record.id, record);
    return record;
  }

  get(sessionId: string): FileSessionRecord | null {
    this.pruneExpired();
    const value = this.sessions.get(sessionId);
    return value ?? null;
  }

  renew(sessionId: string, ttlMs: number): FileSessionRecord | null {
    this.pruneExpired();
    const value = this.sessions.get(sessionId);
    if (!value) return null;
    value.expiresAt = Date.now() + ttlMs;
    this.sessions.set(sessionId, value);
    return value;
  }

  close(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  recordWorkspaceEvent(input: {
    workspaceId: string;
    type: FileSessionEventType;
    path: string;
    toPath?: string;
    revision?: string;
  }): FileSessionEvent {
    return this.workspaceEvents.record(input.workspaceId, (seq) => ({
      id: shortId(),
      seq,
      workspaceId: input.workspaceId,
      type: input.type,
      path: input.path,
      toPath: input.toPath,
      revision: input.revision,
      timestamp: Date.now(),
    }));
  }

  listWorkspaceEvents(workspaceId: string, since = 0): { items: FileSessionEvent[]; cursor: number } {
    return { items: this.workspaceEvents.list(workspaceId, since), cursor: this.workspaceEvents.cursor(workspaceId) };
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.sessions.size < this.maxSessions) return;
    let oldestId: string | null = null;
    let oldestExpiry = Number.POSITIVE_INFINITY;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < oldestExpiry) {
        oldestExpiry = session.expiresAt;
        oldestId = id;
      }
    }
    if (oldestId) {
      this.sessions.delete(oldestId);
    }
  }
}
