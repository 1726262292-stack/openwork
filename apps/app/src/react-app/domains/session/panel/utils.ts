import { isElectronRuntime } from "@/app/utils";

export function getElectronBrowser() {
  if (!isElectronRuntime()) {
    return null;
  }

  return window.__OPENWORK_ELECTRON__?.browser ?? null;
}

export function getNativeMenuPoint(
  el: HTMLElement | null,
  point?: { clientX: number; clientY: number },
) {
  // Same coordinate space as computeBounds: viewport CSS px already match the
  // content-area DIP the native overlay uses, so no zoom multiplication.
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
  // WebContentsView.setBounds expects device-independent pixels relative to the
  // window content area — the same space getBoundingClientRect() reports. The
  // renderer's zoom is already baked into the measured rect, so it must NOT be
  // multiplied in again (doing so pushed the native view off-panel at zoom != 1).
  // Derive width/height from rounded edges to avoid a 1px seam on the far edge.
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
