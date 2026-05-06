import { SCREEN_W, SCREEN_H } from '../types.js';

export interface FadeState {
  type: number;
  step: number;
  maxSteps: number;
}

let globalFadeType = 0;

export function nextFadeState(): FadeState {
  const type = globalFadeType;
  globalFadeType = (globalFadeType + 1) % 5;
  return { type, step: 0, maxSteps: type <= 1 ? 20 : 16 };
}

export function fadeDone(f: FadeState): boolean {
  return f.step >= f.maxSteps;
}

export function applyFade(px: Uint8ClampedArray, f: FadeState): void {
  const s = f.step;
  if (s <= 0) return;

  const fill = (x: number, y: number, w: number, h: number): void => {
    const x0 = Math.max(x, 0), y0 = Math.max(y, 0);
    const x2 = Math.min(x + w, SCREEN_W), y2 = Math.min(y + h, SCREEN_H);
    for (let py = y0; py < y2; py++) {
      const row = py * SCREEN_W;
      for (let qx = x0; qx < x2; qx++) {
        const o = (row + qx) << 2;
        px[o] = px[o + 1] = px[o + 2] = 0;
        px[o + 3] = 255;
      }
    }
  };

  switch (f.type) {
    case 0: { // Expanding circle from center (r = 20..400)
      const r = s * 20;
      const r2 = r * r;
      for (let py = Math.max(0, 240 - r); py < Math.min(SCREEN_H, 240 + r + 1); py++) {
        const dy = py - 240;
        const dx = Math.sqrt(r2 - dy * dy) | 0;
        if (dx > 0) fill(320 - dx, py, dx * 2, 1);
      }
      break;
    }
    case 1: // Expanding rect from center
      fill(320 - s * 16, 240 - s * 12, s * 32, s * 24);
      break;
    case 2: // Right to left
      fill(SCREEN_W - s * 40, 0, s * 40, SCREEN_H);
      break;
    case 3: // Left to right
      fill(0, 0, s * 40, SCREEN_H);
      break;
    case 4: // From center outward
      fill(320 - s * 20, 0, s * 40, SCREEN_H);
      break;
  }
}
