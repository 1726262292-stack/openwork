import { isElectronRuntime } from "@/app/utils";

export function getElectronBrowser() {
  if (!isElectronRuntime()) {
    return null;
  }

  return window.__OPENWORK_ELECTRON__?.browser ?? null;
}

// Bounds and points are sent to the main process in the page's CSS pixels.
// The main process converts them to window DIPs using the authoritative
// webContents.getZoomFactor() at apply time (see scaleBoundsForZoom in
// apps/desktop/electron/main.mjs). The renderer must NOT pre-scale: it has no
// reliable view of the zoom factor (native View menu zoom roles change it
// without notifying the page).
export function getNativeMenuPoint(
  el: HTMLElement | null,
  point?: { clientX: number; clientY: number },
) {
  if (point) {
    return {
      x: Math.round(point.clientX),
      y: Math.round(point.clientY),
    };
  }

  if (!el) {
    return undefined;
  }

  const rect = el.getBoundingClientRect();

  return {
    x: Math.round(rect.left + 8),
    y: Math.round(rect.bottom + 4),
  };
}

export function computeBounds(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);

  return {
    x,
    y,
    width: Math.round(rect.right) - x,
    height: Math.round(rect.bottom) - y,
  };
}

export function sameBounds(
  left: { x: number; y: number; width: number; height: number } | null,
  right: { x: number; y: number; width: number; height: number },
) {
  return Boolean(
    left &&
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height,
  );
}

export function hasNativeBrowserOccluder() {
  const overlays = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  for (const overlay of overlays) {
    if (!(overlay instanceof HTMLElement)) {
      continue;
    }

    if (overlay.offsetParent !== null || overlay.getClientRects().length > 0) {
      return true;
    }
  }
  return false;
}
