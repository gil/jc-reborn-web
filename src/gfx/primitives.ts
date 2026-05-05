import { SCREEN_W, type Layer } from '../types.js';
import { inClip } from './clip.js';

export function putPixel(l: Layer, x: number, y: number, color: number): void {
  if (!inClip(l, x, y)) return;
  l.indexed[y * SCREEN_W + x] = color;
}

export function drawLine(l: Layer, x1: number, y1: number, x2: number, y2: number, color: number): void {
  // Bresenham — port of graphics.c:295-350
  let x = x1, y = y1;
  const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const xinc = x2 > x1 ? 1 : -1;
  const yinc = y2 > y1 ? 1 : -1;
  if (dy < dx) {
    let cumul = (dx + 1) >> 1;
    for (let i = 0; i < dx; i++) {
      putPixel(l, x, y, color);
      x += xinc; cumul += dy;
      if (cumul > dx) { cumul -= dx; y += yinc; }
    }
  } else {
    let cumul = (dy + 1) >> 1;
    for (let i = 0; i < dy; i++) {
      putPixel(l, x, y, color);
      y += yinc; cumul += dx;
      if (cumul > dy) { cumul -= dy; x += xinc; }
    }
  }
}

export function drawRect(l: Layer, x: number, y: number, w: number, h: number, color: number): void {
  // graphics.c grDrawRect uses SDL_FillRect — filled rectangle
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      putPixel(l, xx, yy, color);
    }
  }
}

export function drawCircle(
  l: Layer, x1: number, y1: number, w: number, h: number, fg: number, bg: number,
): void {
  // graphics.c:369-453 — only even diameters, only true circles
  if (w !== h || (w & 1)) return;
  const r = (w >> 1) - 1;
  const xc = x1 + r, yc = y1 + r;
  const hline = (xa: number, xb: number, yy: number, c: number) => {
    for (let xx = xa; xx <= xb; xx++) putPixel(l, xx, yy, c);
  };
  let x = 0, y = r, d = 1 - r;
  while (true) {
    hline(xc - x, xc + x + 1, yc + y + 1, bg);
    hline(xc - x, xc + x + 1, yc - y, bg);
    hline(xc - y, xc + y + 1, yc + x + 1, bg);
    hline(xc - y, xc + y + 1, yc - x, bg);
    if (y - x <= 1) break;
    if (d < 0) d += (x << 1) + 3;
    else { d += ((x - y) << 1) + 5; y--; }
    x++;
  }
  if (fg !== bg) {
    x = 0; y = r; d = 1 - r;
    while (true) {
      putPixel(l, xc - x, yc + y + 1, fg);
      putPixel(l, xc + x + 1, yc + y + 1, fg);
      putPixel(l, xc - x, yc - y, fg);
      putPixel(l, xc + x + 1, yc - y, fg);
      putPixel(l, xc - y, yc + x + 1, fg);
      putPixel(l, xc + y + 1, yc + x + 1, fg);
      putPixel(l, xc - y, yc - x, fg);
      putPixel(l, xc + y + 1, yc - x, fg);
      if (y - x <= 1) break;
      if (d < 0) d += (x << 1) + 3;
      else { d += ((x - y) << 1) + 5; y--; }
      x++;
    }
  }
}
