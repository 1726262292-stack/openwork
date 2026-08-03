const { ipcRenderer } = require("electron");

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
