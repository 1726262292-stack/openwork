import type { ReloadEvent, ReloadReason, ReloadTrigger } from "./types.js";
import { CursorEventStore } from "./cursor-event-store.js";
import { shortId } from "./utils.js";

export class ReloadEventStore {
  private events: CursorEventStore<ReloadEvent>;
  private lastRecorded: Map<string, number> = new Map();

  constructor(maxSize = 200) {
    this.events = new CursorEventStore(maxSize);
  }

  record(workspaceId: string, reason: ReloadReason, trigger?: ReloadTrigger): ReloadEvent {
    return this.events.record((seq) => ({
      id: shortId(),
      seq,
      workspaceId,
      reason,
      trigger,
      timestamp: Date.now(),
    }));
  }

  recordDebounced(
    workspaceId: string,
    reason: ReloadReason,
    trigger?: ReloadTrigger,
    debounceMs = 750,
  ): ReloadEvent | null {
    const now = Date.now();
    const key = `${workspaceId}:${reason}`;
    const last = this.lastRecorded.get(key) ?? 0;
    if (now - last < debounceMs) return null;
    this.lastRecorded.set(key, now);
    return this.record(workspaceId, reason, trigger);
  }

  list(workspaceId: string, since?: number): ReloadEvent[] {
    return this.events.list(workspaceId, since);
  }

  cursor(): number {
    return this.events.cursor();
  }
}
