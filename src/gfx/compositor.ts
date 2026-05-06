import { SCREEN_W, SCREEN_H, TRANSPARENT, type Layer, type Palette } from '../types.js';
import { getSavedZonesLayer } from './zone.js';
import { type FadeState, applyFade } from './fade.js';

export interface CompositeInput {
  background: Uint8Array | null;          // 640*480 indexed; TRANSPARENT (0xff) = index 0
  ttmThreads: (Layer | null)[];           // up to MAX_TTM_THREADS = 10
  holiday: Layer | null;
  palette: Palette;
  fade: FadeState | null;
}

export function composite(out: ImageData, input: CompositeInput): void {
  const px = out.data;
  const N = SCREEN_W * SCREEN_H;
  const saved = getSavedZonesLayer();
  for (let p = 0; p < N; p++) {
    let idx = TRANSPARENT;
    if (input.background) idx = input.background[p]!;
    if (saved && saved[p] !== TRANSPARENT) idx = saved[p]!;
    for (const layer of input.ttmThreads) {
      if (!layer) continue;
      const v = layer.indexed[p]!;
      if (v !== TRANSPARENT) idx = v;
    }
    if (input.holiday) {
      const v = input.holiday.indexed[p]!;
      if (v !== TRANSPARENT) idx = v;
    }
    const o = p * 4;
    if (idx === TRANSPARENT) {
      px[o] = px[o + 1] = px[o + 2] = 0;
      px[o + 3] = 255;
    } else {
      px[o + 0] = input.palette[idx * 4 + 0]!;
      px[o + 1] = input.palette[idx * 4 + 1]!;
      px[o + 2] = input.palette[idx * 4 + 2]!;
      px[o + 3] = 255;
    }
  }
  if (input.fade) applyFade(px, input.fade);
}
