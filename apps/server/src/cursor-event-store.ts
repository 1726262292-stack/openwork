export type WorkspaceCursorEvent = {
  seq: number;
  workspaceId: string;
};

export type CursorEventBuilder<TEvent extends WorkspaceCursorEvent> = (seq: number) => TEvent;

function sinceCursor(since?: number): number {
  return typeof since === "number" && Number.isFinite(since) ? since : 0;
}

export class CursorEventStore<TEvent extends WorkspaceCursorEvent> {
  private events: TEvent[] = [];
  private seq = 0;
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  record(build: CursorEventBuilder<TEvent>): TEvent {
    const nextSeq = this.seq + 1;
    const event = build(nextSeq);
    this.seq = nextSeq;
    this.events.push(event);
    if (this.events.length > this.maxSize) {
      this.events.splice(0, this.events.length - this.maxSize);
    }
    return event;
  }

  list(workspaceId: string, since?: number): TEvent[] {
    const cursor = sinceCursor(since);
    return this.events.filter((event) => event.workspaceId === workspaceId && event.seq > cursor);
  }

  cursor(): number {
    return this.seq;
  }
}

export class WorkspaceCursorEventStore<TEvent extends WorkspaceCursorEvent> {
  private stores = new Map<string, CursorEventStore<TEvent>>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  record(workspaceId: string, build: CursorEventBuilder<TEvent>): TEvent {
    const store = this.storeFor(workspaceId);
    return store.record(build);
  }

  list(workspaceId: string, since?: number): TEvent[] {
    return this.stores.get(workspaceId)?.list(workspaceId, since) ?? [];
  }

  cursor(workspaceId: string): number {
    return this.stores.get(workspaceId)?.cursor() ?? 0;
  }

  private storeFor(workspaceId: string): CursorEventStore<TEvent> {
    const existing = this.stores.get(workspaceId);
    if (existing) return existing;
    const store = new CursorEventStore<TEvent>(this.maxSize);
    this.stores.set(workspaceId, store);
    return store;
  }
}
