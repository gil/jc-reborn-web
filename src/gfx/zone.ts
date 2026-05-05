import { SCREEN_W, SCREEN_H, TRANSPARENT, type Layer } from '../types.js';

let savedZonesLayer: Uint8Array | null = null;

export function getSavedZonesLayer(): Uint8Array | null { return savedZonesLayer; }

function ensureSaved(): Uint8Array {
  if (!savedZonesLayer) {
    savedZonesLayer = new Uint8Array(SCREEN_W * SCREEN_H);
    savedZonesLayer.fill(TRANSPARENT);
  }
  return savedZonesLayer;
}

// Copies a rect of srcLayer into the saved-zones layer (grCopyZoneToBg).
// Width is extended by 2 to match the +2 glitch fix in graphics.c:248.
export function copyZoneToBg(srcLayer: Layer, x: number, y: number, w: number, h: number): void {
  const buf = ensureSaved();
  const W = w + 2;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const X = x + xx, Y = y + yy;
      if (X < 0 || X >= SCREEN_W || Y < 0 || Y >= SCREEN_H) continue;
      buf[Y * SCREEN_W + X] = srcLayer.indexed[Y * SCREEN_W + X]!;
    }
  }
}

// grSaveZone: no-op — we rely on restoreZone to clear the whole layer
export function saveZone(_l: Layer, _x: number, _y: number, _w: number, _h: number): void {}

// grRestoreZone: clears the ENTIRE saved-zones layer regardless of rect args
export function restoreZone(_l: Layer, _x: number, _y: number, _w: number, _h: number): void {
  savedZonesLayer = null;
}

export function saveImage1(_l: Layer, _x: number, _y: number, _w: number, _h: number): void {}

export function clearSavedZones(): void { savedZonesLayer = null; }
