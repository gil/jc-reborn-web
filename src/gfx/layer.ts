import { SCREEN_W, SCREEN_H, TRANSPARENT, type Layer, type Rect } from '../types.js';

export function makeLayer(): Layer {
  const indexed = new Uint8Array(SCREEN_W * SCREEN_H);
  indexed.fill(TRANSPARENT);
  return { indexed, clip: { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H } };
}

export function clearLayer(l: Layer): void { l.indexed.fill(TRANSPARENT); }

export function fillRect(l: Layer, r: Rect, color: number): void {
  const x2 = Math.min(r.x + r.w, SCREEN_W);
  const y2 = Math.min(r.y + r.h, SCREEN_H);
  for (let y = Math.max(0, r.y); y < y2; y++) {
    for (let x = Math.max(0, r.x); x < x2; x++) {
      l.indexed[y * SCREEN_W + x] = color;
    }
  }
}
