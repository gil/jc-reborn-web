import { decodeBmp } from '../decode/bmp.js';
import { decodePal } from '../decode/pal.js';
import { decodeScr } from '../decode/scr.js';
import { COPY_RECT } from '../gfx/gdi/dirty.js';
import type { Display } from '../gfx/gdi/display.js';
import * as primitives from '../gfx/gdi/primitives.js';
import * as sprites from '../gfx/gdi/sprite.js';
import { rawIndices, type DrawState, type Surface } from '../gfx/gdi/surface.js';
import type { ParsedArchive, RawResource } from '../resource/types.js';
import type { TtmDevice } from './device.js';
import type { Bitmaps } from './state.js';

const WALK_BITMAPS = 'JOHNWALK.BMP';

export interface GdiHooks {
  playSound(sample: number): void;
  random(): number;
}

export class GdiDevice implements TtmDevice {
  private walk: Bitmaps | null | undefined;

  constructor(
    private readonly display: Display,
    private readonly draw: DrawState,
    private readonly archive: ParsedArchive,
    private readonly hooks: GdiHooks,
  ) {}

  setSurfaces(source: number, target: number): void {
    this.display.source = source;
    this.display.target = target;
  }

  setPixel(x: number, y: number, color: number): void {
    primitives.setPixel(this.target(), this.draw, x, y, color);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number): void {
    primitives.drawLine(this.target(), this.draw, x1, y1, x2, y2);
  }

  drawRect(x: number, y: number, w: number, h: number): void {
    primitives.drawRect(this.target(), this.draw, x, y, w, h);
  }

  drawCircle(r: number, cx: number, cy: number): void {
    primitives.drawCircle(this.target(), this.draw, r, cx, cy);
  }

  drawSprite(image: Surface, mirroredCopy: boolean, x: number, y: number, flags: number): void {
    sprites.drawSprite(this.target(), this.draw, image, x, y, flags, mirroredCopy);
  }

  drawSpriteStretched(image: Surface, x: number, y: number, flags: number, w: number, h: number): void {
    sprites.drawSpriteStretched(this.target(), this.draw, image, x, y, flags, w, h);
  }

  copyRect(x: number, y: number, w: number, h: number): void {
    this.display.copyRect(x, y, w, h);
  }

  addDirtyRect(x: number, y: number, w: number, h: number, source: number, target: number, age: number): void {
    this.display.dirty.add(x, y, w, h, COPY_RECT, source, target, age, this.draw.clipOn ? this.draw.clip : null);
  }

  dropDirtyList(source: number, target: number, age: number): void {
    this.display.dirty.drop(source, target, age);
  }

  saveZone(id: number, x: number, y: number, w: number, h: number): void {
    this.display.saveRect(id, x, y, w, h);
  }

  restoreZone(id: number, x: number, y: number, w: number, h: number): void {
    this.display.restoreRect(id, x, y, w, h);
  }

  loadScreen(name: string): void {
    const resource = this.find(name);
    if (!resource) return;
    const screen = decodeScr(resource.payload);
    this.display.blitScreen({ width: screen.width, height: screen.height, pixels: rawIndices(screen.indexed) }, 0, 0);
  }

  loadBitmaps(name: string, mirroredCopy: boolean): Bitmaps | null {
    const resource = this.find(name);
    if (!resource) return null;
    return { images: decodeBmp(resource.payload).sprites.map(sprites.spriteSurface), mirrored: mirroredCopy };
  }

  walkBitmaps(): Bitmaps | null {
    if (this.walk === undefined) this.walk = this.loadBitmaps(WALK_BITMAPS, true);
    return this.walk;
  }

  loadPalette(name: string): Uint8Array | null {
    const resource = this.find(name);
    return resource ? decodePal(resource.payload).colors : null;
  }

  playSound(sample: number): void {
    this.hooks.playSound(sample);
  }

  random(): number {
    return this.hooks.random();
  }

  private target(): Surface {
    return this.display.surfaces[this.display.target]!;
  }

  private find(name: string): RawResource | undefined {
    return this.archive.byName.get(name.toUpperCase());
  }
}
