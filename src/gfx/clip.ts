import { SCREEN_W, SCREEN_H, type Layer, type Rect } from '../types.js';

export function setClip(l: Layer, r: Rect): void {
  const x1 = Math.max(0, r.x);
  const y1 = Math.max(0, r.y);
  const x2 = Math.min(SCREEN_W, r.x + r.w);
  const y2 = Math.min(SCREEN_H, r.y + r.h);
  l.clip = { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

export function inClip(l: Layer, x: number, y: number): boolean {
  const c = l.clip;
  return x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
}
