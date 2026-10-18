import { decodeBmp } from '../decode/bmp.js';
import { decodeTtm } from '../decode/ttm-loader.js';
import { spriteSurface } from '../gfx/gdi/sprite.js';
import { makeDrawState, type DrawState, type Surface } from '../gfx/gdi/surface.js';
import type { ParsedArchive } from '../resource/types.js';
import type { TtmDevice } from '../ttm/device.js';
import { makeTtmEnv, runTtmPage } from '../ttm/page-runner.js';
import { loadThreadDrawState, makeThread, makeTtmSlot, type Bitmaps } from '../ttm/state.js';

export type TraceEvent = [string, ...(string | number)[]];

const TRACE_ISLAND_X = 7;
const TRACE_ISLAND_Y = 5;
const TRACE_TTM_ID = 1;

export function traceRandom(call: number): number {
  return (call * 25173 + 13849) & 0xffff;
}

export class RecordingDevice implements TtmDevice {
  events: TraceEvent[] = [];
  source = 0;
  target = 0;
  private readonly imageNames = new Map<Surface, [string, number]>();
  private readonly paletteNames = new Map<Uint8Array, string>();
  private walk: Bitmaps | null | undefined;
  private randomCalls = 0;

  constructor(
    private readonly draw: DrawState,
    private readonly archive: ParsedArchive,
  ) {}

  paletteName(palette: Uint8Array | null): string {
    return palette ? (this.paletteNames.get(palette) ?? '?') : '-';
  }

  setSurfaces(source: number, target: number): void {
    this.source = source;
    this.target = target;
  }

  setPixel(x: number, y: number, color: number): void {
    this.events.push(['pixel', this.target, x, y, color, ...this.clip()]);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number): void {
    this.events.push(['line', this.target, x1, y1, x2, y2, this.draw.foreground, ...this.clip()]);
  }

  drawRect(x: number, y: number, w: number, h: number): void {
    this.events.push(['rect', this.target, x, y, w, h, ...this.colors(), ...this.clip()]);
  }

  drawCircle(r: number, cx: number, cy: number): void {
    this.events.push(['circle', this.target, r, cx, cy, ...this.colors(), ...this.clip()]);
  }

  drawSprite(image: Surface, _mirroredCopy: boolean, x: number, y: number, flags: number): void {
    this.events.push(['sprite', this.target, ...this.imageName(image), x, y, flags, ...this.clip()]);
  }

  drawSpriteStretched(image: Surface, x: number, y: number, flags: number, w: number, h: number): void {
    this.events.push(['stretch', this.target, ...this.imageName(image), x, y, flags, w, h, ...this.clip()]);
  }

  copyRect(x: number, y: number, w: number, h: number): void {
    this.events.push(['copy', this.source, this.target, x, y, w, h]);
  }

  addDirtyRect(x: number, y: number, w: number, h: number, source: number, target: number, age: number): void {
    this.events.push(['dirty', source, target, age, x, y, w, h, ...this.clip()]);
  }

  dropDirtyList(source: number, target: number, age: number): void {
    this.events.push(['drop', source, target, age]);
  }

  saveZone(_id: number, x: number, y: number, w: number, h: number): void {
    this.events.push(['save', this.source, x, y, w, h]);
  }

  restoreZone(_id: number, x: number, y: number, w: number, h: number): void {
    this.events.push(['restore', this.target, x, y, w, h]);
  }

  loadScreen(name: string): void {
    this.events.push(['screen', this.target, name]);
  }

  loadBitmaps(name: string, mirroredCopy: boolean): Bitmaps | null {
    this.events.push(['bitmaps', name, mirroredCopy ? 1 : 0]);
    return this.bitmaps(name, mirroredCopy);
  }

  walkBitmaps(): Bitmaps | null {
    if (this.walk === undefined) this.walk = this.bitmaps('JOHNWALK.BMP', true);
    return this.walk;
  }

  loadPalette(name: string): Uint8Array | null {
    this.events.push(['palette', name]);
    if (!this.archive.byName.has(name.toUpperCase())) return null;
    const palette = new Uint8Array(48);
    this.paletteNames.set(palette, name.toUpperCase());
    return palette;
  }

  playSound(sample: number): void {
    this.events.push(['sound', sample]);
  }

  random(): number {
    this.events.push(['random']);
    return traceRandom(this.randomCalls++);
  }

  private bitmaps(name: string, mirrored: boolean): Bitmaps | null {
    const resource = this.archive.byName.get(name.toUpperCase());
    if (!resource) return null;
    const images = decodeBmp(resource.payload).sprites.map(spriteSurface);
    images.forEach((image, index) => this.imageNames.set(image, [name.toUpperCase(), index]));
    return { images, mirrored };
  }

  private imageName(image: Surface): [string, number] {
    return this.imageNames.get(image) ?? ['?', -1];
  }

  private colors(): number[] {
    return [this.draw.fill ? 1 : 0, this.draw.foreground, this.draw.background];
  }

  private clip(): number[] {
    const { clipOn, clip } = this.draw;
    return [clipOn ? 1 : 0, clip.x1, clip.y1, clip.x2, clip.y2];
  }
}

export function traceTtm(archive: ParsedArchive, name: string): string[] {
  const ttm = decodeTtm(archive.byName.get(name)!.payload);
  const draw = makeDrawState();
  const device = new RecordingDevice(draw, archive);
  const env = makeTtmEnv(device, draw);
  env.islandX = TRACE_ISLAND_X;
  env.islandY = TRACE_ISLAND_Y;
  const thread = makeThread(makeTtmSlot(TRACE_TTM_ID, ttm));
  const rows: string[] = [];
  for (let page = 0; page < ttm.pageOffsets.length; page++) {
    for (const pass of ['first', 'replay'] as const) {
      device.events = [];
      thread.replay = pass === 'replay';
      loadThreadDrawState(thread, draw);
      const result = runTtmPage(env, thread, page);
      device.events.push(['result', result.ran ? 1 : 0, result.delay ?? -1, result.gotoPage ?? -1, result.purge ? 1 : 0, device.paletteName(env.pendingPalette), env.mirrorNextLoad ? 1 : 0, env.keepDrawings ? 1 : 0]);
      device.events.push(['thread', thread.foreground, thread.background, thread.clipOn ? 1 : 0, thread.clip.x1, thread.clip.y1, thread.clip.x2, thread.clip.y2, thread.bmpSlot, thread.paletteSlot, thread.zoneSlot]);
      for (const [event, ...values] of device.events) rows.push([page, pass, event, values.join(' ')].join('\t'));
    }
  }
  return rows;
}
