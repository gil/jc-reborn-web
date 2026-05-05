import { SCREEN_W, TRANSPARENT, type Layer, type Sprite } from '../types.js';
import { inClip } from './clip.js';

export function drawSprite(l: Layer, sp: Sprite, dx: number, dy: number): void {
  for (let y = 0; y < sp.height; y++) {
    for (let x = 0; x < sp.width; x++) {
      const idx = sp.indexed[y * sp.width + x]!;
      if (idx === TRANSPARENT) continue;
      const X = dx + x, Y = dy + y;
      if (!inClip(l, X, Y)) continue;
      l.indexed[Y * SCREEN_W + X] = idx;
    }
  }
}

// Column-by-column right-to-left flip, matching graphics.c:472-491
export function drawSpriteFlip(l: Layer, sp: Sprite, dx: number, dy: number): void {
  for (let i = 0; i < sp.width; i++) {
    for (let y = 0; y < sp.height; y++) {
      const idx = sp.indexed[y * sp.width + i]!;
      if (idx === TRANSPARENT) continue;
      const X = dx + (sp.width - 1 - i), Y = dy + y;
      if (!inClip(l, X, Y)) continue;
      l.indexed[Y * SCREEN_W + X] = idx;
    }
  }
}
