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

export interface AttachedSurface extends Surface, AsyncDisposable {
  stop(): Promise<void>;
}

async function connectToAppTarget(handle: SurfaceHandle): Promise<CdpClient> {
  const target: CdpTarget = handle.kind === "electron"
    ? await pickAppTarget(handle.cdpUrl)
    : await firstPageTarget(handle.cdpUrl);
  const client = await connect(debuggerUrlFor(handle.cdpUrl, target));
  await client.send("Page.enable").catch(() => undefined);
  return client;
}

export async function attachSurface(handle: SurfaceHandle, opts: { timeoutMs?: number } = {}): Promise<AttachedSurface> {
  await waitForCdp(handle.cdpUrl, { timeoutMs: opts.timeoutMs ?? 30_000 });
  const client = await connectToAppTarget(handle);
  const surface: AttachedSurface = {
    handle,
    client,
    stop: async () => surface.client.close(),
    [Symbol.asyncDispose]: async () => surface.client.close(),
  };
  return surface;
}

/**
 * Re-attach to the app's CURRENT page target.
 *
 * The desktop recreates its page target during some transitions (finishing
 * onboarding, for example). Evaluations against the old target then hang rather
 * than fail, which looks exactly like a blocked renderer. The legacy runner had
 * the same escape hatch as `ctx.reconnect()`.
 */
export async function reattachSurface(surface: Surface): Promise<void> {
  try {
    surface.client.close();
  } catch {
    // The old client is already gone; that is the case we are recovering from.
  }
  surface.client = await connectToAppTarget(surface.handle);
}
