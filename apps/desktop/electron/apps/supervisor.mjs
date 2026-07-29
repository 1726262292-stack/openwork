import { resolveSurfaceBounds, surfaceWindowOptions } from "./geometry.mjs"
import {
  APP_PROTOCOL,
  buildContentSecurityPolicy,
  isPermittedNavigation,
  isPermittedRequest,
} from "./protocol.mjs"

// The app runtime supervisor.
//
// Owns the lifetime of everything an app has in the desktop shell: its
// partitioned session, its surface windows, its global shortcuts, and its crash
// record. Electron is injected rather than imported so every decision here is
// testable — what options a window is created with, what happens on disable,
// what a crash loop leads to.
//
// The rule that shapes the whole file: **stopping an app must stop all of it.**
// A teardown that leaves a shortcut registered, a window on screen, or a
// microphone open is not a teardown, so `stop()` is written to be exhaustive and
// is tested for exactly that.

export class AppRuntimeSupervisor {
  #electron
  #installedRoots
  #onCrash
  #onGesture
  #preloadPath
  /** appId -> { windows: Map<surfaceId, window>, shortcuts: string[], session, capturing } */
  #running = new Map()

  constructor({ electron, installedRoots, preloadPath, onCrash, onGesture }) {
    this.#electron = electron
    this.#installedRoots = installedRoots
    this.#preloadPath = preloadPath
    this.#onCrash = onCrash ?? (() => {})
    this.#onGesture = onGesture ?? (() => {})
  }

  isRunning(appId) {
    return this.#running.has(appId)
  }

  runningApps() {
    return [...this.#running.keys()]
  }

  /**
   * Bring an app up.
   *
   * Idempotent: starting an already-running app is a no-op rather than a second
   * set of windows and a second shortcut registration.
   */
  async start(appId, plan) {
    if (this.#running.has(appId)) return this.#running.get(appId)

    const partition = `persist:openwork-app-${appId}`
    const session = this.#electron.session.fromPartition(partition)
    this.#applySessionPolicy(appId, session, plan)

    const state = {
      partition,
      session,
      windows: new Map(),
      shortcuts: [],
      capturing: false,
      allowedHosts: plan.allowedHosts ?? [],
    }
    this.#running.set(appId, state)

    for (const shortcut of plan.shortcuts ?? []) {
      const registered = this.#electron.globalShortcut.register(shortcut.accelerator, () => {
        // A global shortcut is a real user gesture, so it is allowed to mint a
        // token. Nothing else in the runtime can.
        this.#onGesture(appId, shortcut.id)
      })
      if (registered) state.shortcuts.push(shortcut.accelerator)
    }

    return state
  }

  /**
   * Session-level policy.
   *
   * Applied to the partition rather than per-window, so it covers subframes,
   * workers, and anything else the renderer can originate.
   */
  #applySessionPolicy(appId, session, plan) {
    const allowedHosts = plan.allowedHosts ?? []

    // Network enforcement. CSP alone is not enough: this is the layer that
    // catches a request CSP does not cover.
    session.webRequest.onBeforeRequest({ urls: ["*://*/*", `${APP_PROTOCOL}://*/*`] }, (details, callback) => {
      callback({ cancel: !isPermittedRequest(details.url, appId, allowedHosts) })
    })

    session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [buildContentSecurityPolicy(appId, allowedHosts)],
          "X-Content-Type-Options": ["nosniff"],
        },
      })
    })

    // Device and capability permissions. Everything is denied unless the app's
    // manifest permission put it on this list, and the list has no entry for
    // geolocation, notifications, clipboard reads, or screen capture at all.
    session.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permission === "media" && plan.allowMicrophone === true)
    })
    session.setPermissionCheckHandler((_contents, permission) => {
      return permission === "media" && plan.allowMicrophone === true
    })
    // Refuse device selection outright: an app may use the default microphone
    // once granted, and may not enumerate or pick hardware.
    session.setDevicePermissionHandler?.(() => false)
  }

  /** Open one declared surface. */
  async openSurface(appId, surface, display) {
    const state = this.#running.get(appId)
    if (!state) throw new Error(`app ${appId} is not running`)
    const existing = state.windows.get(surface.id)
    if (existing && !existing.isDestroyed()) {
      existing.show()
      return existing
    }

    const bounds = resolveSurfaceBounds(surface.defaultSize, display.workArea, surface.anchor)
    const window = this.#electron.createWindow(
      surfaceWindowOptions({
        appId,
        bounds,
        alwaysOnTop: surface.alwaysOnTop,
        preloadPath: this.#preloadPath,
        partition: state.partition,
      }),
    )

    // Navigation and window creation are refused at the contents level. An app
    // cannot open a popup, and a link to an external site opens in the user's
    // browser instead of inside the sandbox.
    window.webContents.on("will-navigate", (event, url) => {
      if (!isPermittedNavigation(url, appId)) event.preventDefault()
    })
    window.webContents.setWindowOpenHandler((details) => {
      if (/^https:\/\//.test(details.url)) this.#electron.openExternal(details.url)
      return { action: "deny" }
    })
    window.webContents.on("render-process-gone", (_event, details) => {
      this.#onCrash(appId, details?.reason ?? "unknown")
    })
    window.webContents.on("preload-error", () => {
      this.#onCrash(appId, "preload-error")
    })

    if (surface.alwaysOnTop) {
      // `floating` sits above ordinary windows but below system UI, and
      // `visibleOnFullScreenWorkspaces` keeps an ambient surface present without
      // pulling the user out of a full-screen app.
      window.setAlwaysOnTop?.(true, "floating")
      window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreenWorkspaces: true })
    }

    await window.loadURL(`${APP_PROTOCOL}://${appId}/${surface.entrypoint}`)
    state.windows.set(surface.id, window)
    return window
  }

  closeSurface(appId, surfaceId) {
    const state = this.#running.get(appId)
    const window = state?.windows.get(surfaceId)
    if (!window) return false
    state.windows.delete(surfaceId)
    if (!window.isDestroyed()) window.destroy()
    return true
  }

  /**
   * Tear an app down completely.
   *
   * Order matters: capture stops before windows close, so the microphone is
   * released even if destroying a window throws. Every step is attempted
   * regardless of earlier failures — a partial teardown is the failure mode
   * this method exists to prevent.
   */
  async stop(appId, options = {}) {
    const state = this.#running.get(appId)
    if (!state) return false
    this.#running.delete(appId)

    const problems = []
    const attempt = (label, action) => {
      try {
        action()
      } catch (error) {
        problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    attempt("capture", () => {
      state.capturing = false
      this.#electron.stopCapture?.(appId)
    })

    for (const accelerator of state.shortcuts) {
      attempt(`shortcut ${accelerator}`, () => this.#electron.globalShortcut.unregister(accelerator))
    }
    state.shortcuts = []

    for (const [surfaceId, window] of state.windows) {
      attempt(`window ${surfaceId}`, () => {
        if (!window.isDestroyed()) window.destroy()
      })
    }
    state.windows.clear()

    // Clearing the partition is the difference between "stopped" and "gone".
    // On uninstall the app must keep nothing: no cache, no storage, no service
    // worker that could run again.
    if (options.purgeStorage === true) {
      attempt("storage", () => state.session.clearStorageData?.())
    }
    attempt("session-handlers", () => {
      state.session.setPermissionRequestHandler?.(null)
      state.session.setPermissionCheckHandler?.(null)
    })

    if (problems.length > 0 && options.throwOnPartial === true) {
      throw new Error(`incomplete teardown for ${appId}: ${problems.join("; ")}`)
    }
    return true
  }

  /** Stop everything. Used on quit and on workspace teardown. */
  async stopAll(options = {}) {
    const ids = this.runningApps()
    for (const appId of ids) await this.stop(appId, options)
    return ids
  }

  markCapturing(appId, capturing) {
    const state = this.#running.get(appId)
    if (!state) return false
    state.capturing = capturing
    return true
  }

  isCapturing(appId) {
    return this.#running.get(appId)?.capturing === true
  }

  /** Absolute install root for the running version of each app. */
  installedRoots() {
    return this.#installedRoots
  }
}
