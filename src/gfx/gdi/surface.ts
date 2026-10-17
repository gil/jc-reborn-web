import { SCREEN_H, SCREEN_W, TRANSPARENT } from '../../types.js';

export interface Surface {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface ClipRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DrawState {
  foreground: number;
  background: number;
  fill: boolean;
  clipOn: boolean;
  clip: ClipRect;
}

export function makeSurface(width = SCREEN_W, height = SCREEN_H): Surface {
  return { width, height, pixels: new Uint8Array(width * height) };
}

export function makeDrawState(): DrawState {
  return {
    foreground: 0,
    background: 0,
    fill: true,
    clipOn: false,
    clip: { x1: 0, y1: 0, x2: SCREEN_W - 1, y2: SCREEN_H - 1 },
  };
}

export function activeClip(surface: Surface, state: DrawState): ClipRect {
  const whole = { x1: 0, y1: 0, x2: surface.width - 1, y2: surface.height - 1 };
  if (!state.clipOn) return whole;
  return {
    x1: Math.max(whole.x1, state.clip.x1),
    y1: Math.max(whole.y1, state.clip.y1),
    x2: Math.min(whole.x2, state.clip.x2),
    y2: Math.min(whole.y2, state.clip.y2),
  };
}

export function plot(surface: Surface, clip: ClipRect, x: number, y: number, index: number): void {
  if (x < clip.x1 || x > clip.x2 || y < clip.y1 || y > clip.y2) return;
  surface.pixels[y * surface.width + x] = index;
}

export function rawIndices(indexed: Uint8Array): Uint8Array {
  return indexed.map((index) => (index === TRANSPARENT ? 0 : index));
}
