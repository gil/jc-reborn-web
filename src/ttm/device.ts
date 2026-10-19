import type { Surface } from '../gfx/gdi/surface.js';
import type { Bitmaps } from './state.js';

export interface TtmDevice {
  setSurfaces(source: number, target: number): void;
  setPixel(x: number, y: number, color: number): void;
  drawLine(x1: number, y1: number, x2: number, y2: number): void;
  drawRect(x: number, y: number, w: number, h: number): void;
  drawCircle(r: number, cx: number, cy: number): void;
  drawSprite(image: Surface, mirroredCopy: boolean, x: number, y: number, flags: number): void;
  drawSpriteStretched(image: Surface, x: number, y: number, flags: number, w: number, h: number): void;
  copyRect(x: number, y: number, w: number, h: number): void;
  addDirtyRect(x: number, y: number, w: number, h: number, source: number, target: number, age: number): void;
  dropDirtyList(source: number, target: number, age: number): void;
  saveZone(id: number, x: number, y: number, w: number, h: number): void;
  restoreZone(id: number, x: number, y: number, w: number, h: number): void;
  loadScreen(name: string): void;
  loadBitmaps(name: string, mirroredCopy: boolean): Bitmaps | null;
  walkBitmaps(): Bitmaps | null;
  loadPalette(name: string): Uint8Array | null;
  playSound(sample: number): void;
  random(): number;
}
