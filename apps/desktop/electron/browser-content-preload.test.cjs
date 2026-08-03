const assert = require("node:assert/strict");
const Module = require("node:module");
const { test } = require("node:test");

const originalLoad = Module._load;
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
let mainWorldScript;

Module._load = function (request, parent, isMain) {
  if (request === "electron") {
    return {
      contextBridge: {
        exposeInMainWorld() {},
        executeInMainWorld(script) { mainWorldScript = script; },
      },
      ipcRenderer: { send() {} },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
globalThis.document = { readyState: "loading", addEventListener() {} };
globalThis.window = { addEventListener() {} };
try {
  require("./browser-content-preload.cjs");
} finally {
  Module._load = originalLoad;
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
}

test("passkey fallback stays quiet when Touch ID is available", async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const publicKeyCredentialDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "PublicKeyCredential",
  );
  const bridgeKey = mainWorldScript.args[0];
  const bridgeDescriptor = Object.getOwnPropertyDescriptor(globalThis, bridgeKey);
  let nativeCalls = 0;
  let fallbackNotifications = 0;
  const credentials = {
    create() { nativeCalls += 1; return Promise.resolve("native-create"); },
    get() { nativeCalls += 1; return Promise.resolve("native-get"); },
  };

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { credentials },
  });
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    value: {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
    },
  });
  Object.defineProperty(globalThis, bridgeKey, {
    configurable: true,
    value: { notifyUnavailable() { fallbackNotifications += 1; } },
  });

  try {
    mainWorldScript.func(...mainWorldScript.args);
    assert.equal(await credentials.get({ publicKey: {} }), "native-get");
    assert.equal(nativeCalls, 1);
    assert.equal(fallbackNotifications, 0);
  } finally {
    restoreProperty("navigator", navigatorDescriptor);
    restoreProperty("PublicKeyCredential", publicKeyCredentialDescriptor);
    restoreProperty(bridgeKey, bridgeDescriptor);
  }
});

function restoreProperty(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
}
