import { SCREEN_H, SCREEN_W } from '../types.js';

export interface FadeState {
  type: number;
  step: number;
  maxSteps: number;
}

export interface WipeShape {
  kind: 'rect' | 'ellipse';
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const WIPE_TICKS = 16;

const ELLIPSE_OUT = 0;
const RECT_OUT = 1;
const RIGHT_TO_LEFT = 2;
const LEFT_TO_RIGHT = 3;
const TOP_TO_BOTTOM = 4;
const BOTTOM_TO_TOP = 5;
const WIPE_COUNT = 6;

let nextWipe = ELLIPSE_OUT;

export function nextFadeState(): FadeState {
  const type = nextWipe;
  nextWipe = (nextWipe + 1) % WIPE_COUNT;
  return { type, step: 0, maxSteps: WIPE_TICKS };
}

export function fadeDone(f: FadeState): boolean {
  return f.step >= f.maxSteps;
}

export function wipeShapes(type: number, x: number, y: number, w: number, h: number): WipeShape[] {
  const shapes: WipeShape[] = [];
  const rect = (left: number, top: number, right: number, bottom: number) => shapes.push({ kind: 'rect', left, top, right, bottom });
  let halfW = Math.trunc(w / 2);
  let halfH = Math.trunc(h / 2);
  const cx = x + halfW;
  const cy = y + halfH;
  switch (type) {
    case ELLIPSE_OUT: {
      let step = 1;
      let radius = 1;
      while (halfW > 0 || halfH > 0) {
        halfW -= step;
        halfH -= step;
        radius += step;
        step++;
        shapes.push({ kind: 'ellipse', left: cx - radius, top: cy - radius, right: cx + radius, bottom: cy + radius });
      }
      break;
    }
    case RECT_OUT: {
      const stepX = Math.trunc(cx / 50);
      const stepY = Math.trunc(cy / 50);
      for (let ix = stepX, iy = stepY; halfW > 0 || halfH > 0; ix += stepX, iy += stepY, halfW -= stepX, halfH -= stepY) {
        rect(cx - ix, cy - iy, cx + ix, cy + iy);
      }
      break;
    }
    case RIGHT_TO_LEFT:
    case LEFT_TO_RIGHT: {
      const strip = Math.trunc(w / 100);
      const fromRight = type === RIGHT_TO_LEFT;
      for (let left = fromRight ? x + w - strip : x, rest = w; rest > 0; left += fromRight ? -strip : strip, rest -= strip) {
        rect(left, y, left + strip, y + h);
      }
      break;
    }
    case TOP_TO_BOTTOM:
    case BOTTOM_TO_TOP: {
      const strip = Math.trunc(h / 200);
      const fromBottom = type === BOTTOM_TO_TOP;
      for (let top = fromBottom ? y + h - strip : y, rest = h; rest > 0; top += fromBottom ? -strip : strip, rest -= strip) {
        rect(x, top, x + w, top + strip);
      }
      break;
    }
  }
  return shapes;
}

export function applyFade(px: Uint8ClampedArray, f: FadeState): void {
  if (f.step <= 0) return;
  if (fadeDone(f)) {
    paintRect(px, 0, 0, SCREEN_W, SCREEN_H);
    return;
  }
  const shapes = wipeShapes(f.type, 0, 0, SCREEN_W, SCREEN_H);
  const shown = Math.ceil((shapes.length * f.step) / f.maxSteps);
  // The ellipse and rect wipes grow around one center, so their last shape covers every earlier one.
  const visible = f.type === ELLIPSE_OUT || f.type === RECT_OUT ? shapes.slice(shown - 1, shown) : shapes.slice(0, shown);
  for (const shape of visible) {
    if (shape.kind === 'rect') paintRect(px, shape.left, shape.top, shape.right, shape.bottom);
    else paintEllipse(px, shape);
  }
}

function paintBlack(px: Uint8ClampedArray, x: number, y: number): void {
  const o = (y * SCREEN_W + x) * 4;
  px[o] = px[o + 1] = px[o + 2] = 0;
  px[o + 3] = 255;
}

function paintRect(px: Uint8ClampedArray, left: number, top: number, right: number, bottom: number): void {
  for (let y = Math.max(top, 0); y < Math.min(bottom, SCREEN_H); y++) {
    for (let x = Math.max(left, 0); x < Math.min(right, SCREEN_W); x++) paintBlack(px, x, y);
  }
}

function paintEllipse(px: Uint8ClampedArray, { left, top, right, bottom }: WipeShape): void {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const radius = (right - left) / 2;
  for (let y = Math.max(top, 0); y < Math.min(bottom, SCREEN_H); y++) {
    for (let x = Math.max(left, 0); x < Math.min(right, SCREEN_W); x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius * radius) paintBlack(px, x, y);
    }
  }
}
