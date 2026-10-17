import { SCREEN_H, SCREEN_W } from '../../types.js';
import { DirtyLists, NO_SOURCE } from './dirty.js';
import { makeSurface, type Surface } from './surface.js';

export const SURFACE_A = 0;
export const SURFACE_B = 1;
export const SURFACE_C = 2;

export const RESTORE_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [NO_SOURCE, SURFACE_A],
  [SURFACE_B, SURFACE_A],
  [NO_SOURCE, SURFACE_B],
  [SURFACE_C, SURFACE_B],
  [NO_SOURCE, SURFACE_C],
  [SURFACE_A, SURFACE_C],
  [SURFACE_A, SURFACE_B],
  [SURFACE_B, SURFACE_C],
  [SURFACE_C, SURFACE_A],
];

export const SINGLE_RESTORE_PAIRS: ReadonlyArray<readonly [number, number]> = [[SURFACE_B, SURFACE_A]];

interface SavedRect {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export class Display {
  readonly surfaces: Surface[] = [makeSurface(), makeSurface(), makeSurface()];
  readonly dirty = new DirtyLists(SCREEN_W, SCREEN_H);
  source = SURFACE_A;
  target = SURFACE_A;
  screenIsB = false;
  private readonly saved = new Map<number, SavedRect>();

  shown(): Surface {
    return this.surfaces[this.screenIsB ? SURFACE_B : SURFACE_A]!;
  }

  copyRect(x: number, y: number, w: number, h: number): void {
    if (this.source === this.target || w === 0 || h === 0) return;
    w += x % 8;
    x -= x % 8;
    w += 8 - (w % 8);
    if (this.screenIsB && this.target === SURFACE_A) return;
    copyPixels(this.surfaces[this.source]!, x, y, this.surfaces[this.target]!, x, y, w, h);
  }

  saveRect(id: number, x: number, y: number, w: number, h: number): void {
    const rect = { width: w, height: h, pixels: new Uint8Array(w * h) };
    copyPixels(this.surfaces[this.source]!, x, y, rect, 0, 0, w, h);
    this.saved.set(id, rect);
  }

  restoreRect(id: number, x: number, y: number, w: number, h: number): void {
    const rect = this.saved.get(id);
    if (rect) copyPixels(rect, 0, 0, this.surfaces[this.target]!, x, y, w, h);
  }

  blitScreen(image: Surface, x: number, y: number): void {
    copyPixels(image, 0, 0, this.surfaces[this.target]!, x, y, image.width, image.height);
  }

  restorePass(which: number): void {
    const { source, target } = this;
    const pairs = which === 0 ? RESTORE_PAIRS : SINGLE_RESTORE_PAIRS;
    for (const event of this.dirty.restorePass(pairs, which === 0)) {
      this.target = event.target;
      if (event.kind === 'copy') {
        this.source = event.source;
        this.copyRect(event.x, event.y, event.w, event.h);
      } else {
        this.restoreRect(event.saved, event.x, event.y, event.w, event.h);
      }
    }
    this.source = source;
    this.target = target;
  }
}

function copyPixels(from: Surface, fromX: number, fromY: number, to: Surface, toX: number, toY: number, w: number, h: number): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sx = fromX + i;
      const sy = fromY + j;
      const dx = toX + i;
      const dy = toY + j;
      if (sx < 0 || sy < 0 || sx >= from.width || sy >= from.height) continue;
      if (dx < 0 || dy < 0 || dx >= to.width || dy >= to.height) continue;
      to.pixels[dy * to.width + dx] = from.pixels[sy * from.width + sx]!;
    }
  }
}
