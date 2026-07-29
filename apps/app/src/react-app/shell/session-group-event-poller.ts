import type { OpenworkSessionGroupEvent } from "@/app/lib/openwork-server";

export type SessionGroupEventResponse = {
  items: OpenworkSessionGroupEvent[];
  cursor?: number;
};

export class SessionGroupEventPoller {
  private cursorByWorkspace = new Map<string, number>();

  async poll(
    key: string,
    request: (options: { since: number }) => Promise<SessionGroupEventResponse>,
    apply: () => Promise<void>,
  ): Promise<void> {
    const currentCursor = this.cursorByWorkspace.get(key) ?? 0;
    const response = await request({ since: currentCursor });
    this.cursorByWorkspace.set(
      key,
      typeof response.cursor === "number"
        ? response.cursor
        : Math.max(currentCursor, ...response.items.map((item) => Number(item.seq) || 0)),
    );
    if (currentCursor === 0 || response.items.length === 0) return;
    await apply();
  }
}
