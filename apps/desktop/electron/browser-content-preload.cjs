const { contextBridge, ipcRenderer } = require("electron");

const PASSKEY_BRIDGE_KEY = "__OPENWORK_PASSKEY_FALLBACK__";

contextBridge.exposeInMainWorld(PASSKEY_BRIDGE_KEY, {
  notifyUnavailable() {
    ipcRenderer.send("openwork:browser:passkey-unavailable");
  },
});

// This runs in the page's Main World, where page scripts see the overridden methods.
contextBridge.executeInMainWorld({
  func: (bridgeKey) => {
    const credentials = navigator.credentials;
    const publicKeyCredential = globalThis.PublicKeyCredential;
    if (
      !credentials ||
      typeof publicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable !== "function"
    ) {
      return;
    }

    let capabilityProbe;
    try {
      capabilityProbe = publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return;
    }
    const platformAuthenticatorAvailable = Promise.resolve(capabilityProbe).catch(() => true);

    for (const methodName of ["create", "get"]) {
      const originalMethod = credentials[methodName];
      if (typeof originalMethod !== "function") continue;

      Object.defineProperty(credentials, methodName, {
        configurable: true,
        writable: true,
        value: function (...args) {
          const options = args[0];
          if (!options || typeof options !== "object" || options.publicKey == null) {
            return Reflect.apply(originalMethod, this, args);
          }

          return platformAuthenticatorAvailable.then((available) => {
            if (available !== false) {
              return Reflect.apply(originalMethod, this, args);
            }
            globalThis[bridgeKey]?.notifyUnavailable();
            throw new DOMException("The operation was not allowed.", "NotAllowedError");
          });
        },
      });
    }
  },
  args: [PASSKEY_BRIDGE_KEY],
});

function dismissMenuOverlay(event) {
  if (event.type === "pointerdown" && (event.button === 2 || event.buttons === 2)) return;
  ipcRenderer.send("openwork:menu-overlay:dismiss");
}

function installDismissListeners() {
  window.addEventListener("pointerdown", dismissMenuOverlay, { capture: true });
  window.addEventListener("wheel", dismissMenuOverlay, { capture: true, passive: true });
  window.addEventListener("keydown", dismissMenuOverlay, { capture: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installDismissListeners, { once: true });
} else {
  installDismissListeners();
}
