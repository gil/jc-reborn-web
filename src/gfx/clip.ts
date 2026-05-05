import type { Layer, Rect } from '../types.js';

export function setClip(l: Layer, r: Rect): void {
  l.clip = {
    x: Math.max(0, r.x),
    y: Math.max(0, r.y),
    w: Math.min(640 - r.x, r.w),
    h: Math.min(480 - r.y, r.h),
  };
}

export function inClip(l: Layer, x: number, y: number): boolean {
  const c = l.clip;
  return x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
}
