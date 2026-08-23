import { createAndSelectWorkspace, signInDesktopAs } from "@openwork/behaviors";
import type { Surface } from "@openwork/cdp";
import { desktop } from "@openwork/hosts";
import type { DesktopHandle, Host } from "@openwork/hosts";
import type { Den } from "./den.ts";
import type { Place } from "./place.ts";

interface SharedAppOptions {
  den: Den;
  place: Place;
  host?: Host;
  model?: string;
  workspacePath?: string;
  /** Reuse this caller-owned local Electron profile root instead of creating one. */
  profileDir?: string;
  /** Eval-only delay before the desktop starts its embedded OpenWork server. */
  localServerDelayMs?: number;
  /** Observe a fresh profile after workspace setup but before Cloud sign-in. */
  beforeSignIn?: (surface: Surface) => Promise<void>;
}

export interface SignedInAppOptions extends SharedAppOptions {
  as: string;
  signIn?: true;
}

export interface FreshAppOptions extends SharedAppOptions {
  as?: never;
  signIn: false;
}

export type AppOptions = SignedInAppOptions | FreshAppOptions;

/** A desktop; its Electron profile root is available at handle.profileDir. */
export interface App extends DesktopHandle {
  workspaceId: string;
}

export async function app(options: AppOptions): Promise<App> {
  if (options.signIn === false) {
    const env: Record<string, string> = {};
    if (options.model) env.OPENWORK_EVAL_MODEL = options.model;
    if (options.localServerDelayMs !== undefined) {
      env.OPENWORK_EVAL_LOCAL_SERVER_DELAY_MS = String(options.localServerDelayMs);
    }
    const surface = await desktop({
      name: "testkit-fresh",
      host: options.host ?? options.place.host(),
      profileDir: options.profileDir,
      bootstrap: {
        baseUrl: options.den.ref.webUrl,
        requireSignin: false,
      },
      env: Object.keys(env).length > 0 ? env : undefined,
    });
    try {
      const path = options.workspacePath ?? `/tmp/openwork-fresh-${Date.now()}`;
      const { workspaceId } = await createAndSelectWorkspace(surface, { path });
      await options.beforeSignIn?.(surface);
      return {
        handle: surface.handle,
        client: surface.client,
        readiness: surface.readiness,
        workspaceRoot: surface.workspaceRoot,
        workspaceId,
        stop: () => surface.stop(),
        [Symbol.asyncDispose]: () => surface[Symbol.asyncDispose](),
      };
    } catch (error) {
      await surface[Symbol.asyncDispose]();
      throw error;
    }
  }
  const member = options.as === "admin" ? options.den.admin : options.den.members[options.as];
  if (!member) {
    const available = ["admin", ...Object.keys(options.den.members)].join(", ");
    throw new Error(`Unknown Den member ${JSON.stringify(options.as)}. Available: ${available}`);
  }
  const env: Record<string, string> = {};
  if (options.model) env.OPENWORK_EVAL_MODEL = options.model;
  if (options.localServerDelayMs !== undefined) {
    env.OPENWORK_EVAL_LOCAL_SERVER_DELAY_MS = String(options.localServerDelayMs);
  }
  const surface = await desktop({
    name: `testkit-${options.as}`,
    host: options.host ?? options.place.host(),
    profileDir: options.profileDir,
    bootstrap: {
      baseUrl: options.den.ref.webUrl,
      requireSignin: false,
    },
    env: Object.keys(env).length > 0 ? env : undefined,
  });
  try {
    // Workspace first, then the org sign-in: the signed-in org shell offers no
    // Add workspace entry, so a member's workspace exists before they connect.
    const path = options.workspacePath ?? `/tmp/openwork-${options.as}-${Date.now()}`;
    await createAndSelectWorkspace(surface, { path });
    await options.beforeSignIn?.(surface);
    await signInDesktopAs(surface, options.den.ref, member);
    const { workspaceId } = await createAndSelectWorkspace(surface, { path });
    return {
      handle: surface.handle,
      client: surface.client,
      readiness: surface.readiness,
      workspaceRoot: surface.workspaceRoot,
      workspaceId,
      stop: () => surface.stop(),
      [Symbol.asyncDispose]: () => surface[Symbol.asyncDispose](),
    };
  } catch (error) {
    await surface[Symbol.asyncDispose]();
    throw error;
  }
}
