import { connect, debuggerUrlFor, pickAppTarget } from "./cdp.ts";
import { firstPageTarget, waitForCdp } from "./targets.ts";
import type { CdpClient, CdpTarget } from "./cdp.ts";

export type SurfaceKind = "electron" | "chrome";

export interface SurfaceHandle {
  name: string;
  kind: SurfaceKind;
  hostKind: string;
  cdpUrl: string;
  pid?: number;
  profileDir?: string;
  sandboxId?: string;
  meta?: Record<string, string>;
}

export interface Surface {
  handle: SurfaceHandle;
  client: CdpClient;
}

export async function attachSurface(handle: SurfaceHandle, opts: { timeoutMs?: number } = {}): Promise<Surface> {
  await waitForCdp(handle.cdpUrl, { timeoutMs: opts.timeoutMs ?? 30_000 });
  const target: CdpTarget = handle.kind === "electron"
    ? await pickAppTarget(handle.cdpUrl)
    : await firstPageTarget(handle.cdpUrl);
  const client = await connect(debuggerUrlFor(handle.cdpUrl, target));
  await client.send("Page.enable").catch(() => undefined);
  return { handle, client };
}
