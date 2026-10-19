import { decodeBmp } from '../decode/bmp.js';
import { decodeScr } from '../decode/scr.js';
import { COPY_RECT } from '../gfx/gdi/dirty.js';
import type { Display } from '../gfx/gdi/display.js';
import { drawLine, drawRect } from '../gfx/gdi/primitives.js';
import { drawSprite, spriteSurface } from '../gfx/gdi/sprite.js';
import { makeDrawState, rawIndices, type ClipRect, type DrawState, type Surface } from '../gfx/gdi/surface.js';
import type { ParsedArchive } from '../resource/types.js';

export interface SpriteSheet {
  name: string;
  images: Surface[];
}

export interface IslandDevice {
  loadSheet(name: string): SpriteSheet | null;
  loadScreen(name: string): void;
  setSource(surface: number): void;
  setTarget(surface: number): void;
  fillRect(x: number, y: number, w: number, h: number, color: number): void;
  drawSprite(sheet: SpriteSheet, index: number, x: number, y: number, flags: number): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, color: number): void;
  copyRect(x: number, y: number, w: number, h: number): void;
  addDirtyRect(x: number, y: number, w: number, h: number, source: number, target: number, age: number): void;
  dirtyOverlaps(x: number, y: number, w: number, h: number, target: number, age: number): boolean;
  setClip(clip: ClipRect | null): void;
}

export function loadSheet(archive: ParsedArchive, name: string): SpriteSheet | null {
  const resource = archive.byName.get(name);
  return resource ? { name, images: decodeBmp(resource.payload).sprites.map(spriteSurface) } : null;
}

export class DisplayIslandDevice implements IslandDevice {
  private readonly draw: DrawState = makeDrawState();
  private readonly wholeScreen = { ...this.draw.clip };

  constructor(
    private readonly display: Display,
    private readonly archive: ParsedArchive,
  ) {}

  loadSheet(name: string): SpriteSheet | null {
    return loadSheet(this.archive, name);
  }

  loadScreen(name: string): void {
    const resource = this.archive.byName.get(name);
    if (!resource) return;
    const screen = decodeScr(resource.payload);
    this.display.blitScreen({ width: screen.width, height: screen.height, pixels: rawIndices(screen.indexed) }, 0, 0);
  }

  setSource(surface: number): void {
    this.display.source = surface;
  }

  setTarget(surface: number): void {
    this.display.target = surface;
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    Object.assign(this.draw, { fill: true, foreground: color, background: color });
    drawRect(this.target(), this.draw, x, y, w, h);
  }

  drawSprite(sheet: SpriteSheet, index: number, x: number, y: number, flags: number): void {
    const image = sheet.images[index];
    if (image) drawSprite(this.target(), this.draw, image, x, y, flags);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, color: number): void {
    this.draw.foreground = color;
    drawLine(this.target(), this.draw, x1, y1, x2, y2);
  }

  copyRect(x: number, y: number, w: number, h: number): void {
    this.display.copyRect(x, y, w, h);
  }

  addDirtyRect(x: number, y: number, w: number, h: number, source: number, target: number, age: number): void {
    this.display.dirty.add(x, y, w, h, COPY_RECT, source, target, age, this.draw.clipOn ? this.draw.clip : null);
  }

  dirtyOverlaps(x: number, y: number, w: number, h: number, target: number, age: number): boolean {
    return this.display.dirty.overlaps(x, y, w, h, target, age) !== 0;
  }

  setClip(clip: ClipRect | null): void {
    this.draw.clipOn = clip !== null;
    this.draw.clip = clip ?? { ...this.wholeScreen };
  }

  private target(): Surface {
    return this.display.surfaces[this.display.target]!;
  }
}
