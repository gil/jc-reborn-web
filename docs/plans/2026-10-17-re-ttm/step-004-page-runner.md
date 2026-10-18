# Step 4: Page Runner

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-003-original-page-trace.md`

**Files:**

- Modify: `src/ttm/opcodes.ts` (renamed and added keys), `src/ttm/interpreter.ts` (case labels only, until step 6 deletes it)
- Create: `src/ttm/state.ts`, `src/ttm/device.ts`, `src/ttm/page-runner.ts`, `src/ttm/page-runner.test.ts`, `src/ttm/page-runner.data.test.ts`, `src/testing/ttm-recorder.ts`
- Modify: `docs/re/ttm.md` (checklist rows), `docs/re/open-questions.md` (OQ-23)

**Interfaces:**

- Consumes: `readTtmInstruction(bytecode, offset): { opcode; args: number[] (unsigned words); text?: string; next }` (`src/decode/ttm-bytecode.ts`); `TtmResource { pageCount; bytecode; pageOffsets; tags }` (`src/decode/ttm-loader.ts`); `decodeTtm`, `decodeBmp`; `SURFACE_A = 0`, `SURFACE_B = 1`, `SURFACE_C = 2` (`src/gfx/gdi/display.ts`); `Surface`, `ClipRect`, `DrawState`, `makeDrawState`, `makeSurface` (`src/gfx/gdi/surface.ts`); `spriteSurface` (`src/gfx/gdi/sprite.ts`); `setPaletteColors` (`src/gfx/palette.ts`); `SCREEN_W`, `SCREEN_H`, `Palette` (`src/types.ts`); `ParsedArchive` (`src/resource/types.ts`); `hasFixture`, `loadArchive`, `readFixtureRows` (`src/testing/corpus.ts`). The trace fixture `re/fixtures/ttm/traces.tsv` and its format (overview, `Trace format`).
- Produces (used by steps 5 and 6):
  - `src/ttm/state.ts`: `BMP_SLOTS = 6`, `PALETTE_SLOTS = 6`, `ZONE_SLOTS = 12`, `interface Bitmaps { images: Surface[]; mirrored: boolean }`, `interface Zone { x; y; w; h }`, `interface TtmSlot { id: number; ttm: TtmResource | null; bitmaps: (Bitmaps | null)[]; palettes: (Uint8Array | null)[]; zones: (Zone | null)[] }`, `interface TtmThread` (fields below), `makeTtmSlot(id: number, ttm: TtmResource | null): TtmSlot`, `makeThread(slot?: TtmSlot): TtmThread`, `zoneId(slotId: number, zone: number): number`, `loadThreadDrawState(thread: TtmThread, draw: DrawState): void`, `resetDrawClip(draw: DrawState): void`.
  - `src/ttm/device.ts`: `interface TtmDevice` (methods below).
  - `src/ttm/page-runner.ts`: `interface TtmEnv { device; draw; islandX; islandY; pendingPalette: Uint8Array | null; mirrorNextLoad: boolean; keepDrawings: boolean }`, `interface PageResult { ran: boolean; delay: number | null; gotoPage: number | null; purge: boolean }`, `makeTtmEnv(device: TtmDevice, draw: DrawState): TtmEnv`, `runTtmPage(env: TtmEnv, thread: TtmThread, page: number): PageResult`, `pageOfTag(ttm: TtmResource, tag: number): number`, `randomDelay(random: number, low: number, high: number): number`, `activatePendingPalette(env: TtmEnv, palette: Palette): void`.
  - `src/testing/ttm-recorder.ts`: `class RecordingDevice implements TtmDevice` (`events`, `source`, `target`, `paletteName(palette)`), `traceRandom(call: number): number`, `traceTtm(archive: ParsedArchive, name: string): string[]`.

`TtmThread` fields: scheduler lifecycle (`isRunning: 0 | 1 | 2`, `sceneSlot`, `sceneTag`, `sceneTimer`, `sceneIterations`, `delay`, `timer`), pages (`tagPage`, `page`, `nextPage` (-1 = none), `replay` (node flag `[7]`), `purged`), and the drawing state the original keeps per thread (`paletteSlot`, `bmpSlot`, `zoneSlot`, `foreground`, `background`, `clipOn`, `clip: ClipRect`).

The old interpreter (`src/ttm/interpreter.ts`, `thread.ts`, `bmp-slots.ts`) keeps running the engine until step 6. Do not wire anything here. The new types live in `state.ts` so both can exist side by side.

## Part A: Opcode names

- [x] **Action 1: Rename the opcodes to what they do**

Replace the `OP` object in `src/ttm/opcodes.ts` (keep `TTM_OPCODE_NAMES` as it is):

```ts
export const OP = {
  SCREEN_TO_BACKGROUND: 0x0020,
  FREE_PALETTE: 0x0070,
  FREE_IMAGES: 0x0080,
  FREE_ZONE: 0x00c0,
  PURGE: 0x0110,
  KEEP_DRAWINGS: 0x0500,
  ERASE_DRAWINGS: 0x0510,
  UPDATE: 0x0ff0,
  SET_DELAY: 0x1021,
  SET_BMP_SLOT: 0x1051,
  SET_PALETTE_SLOT: 0x1061,
  LOCAL_TAG: 0x1101,
  TAG: 0x1111,
  SET_ZONE_SLOT: 0x1121,
  GOTO_TAG: 0x1201,
  PLAY_SAMPLE_ALIAS: 0x1301,
  STOP_SAMPLE_ALIAS: 0x1311,
  SET_COLORS: 0x2002,
  MIRROR_NEXT_LOAD: 0x2012,
  RANDOM_DELAY: 0x2022,
  CALL_PAGE: 0x3003,
  DIRTY_SCREEN: 0x3103,
  SET_CLIP_ZONE: 0x4004,
  COPY_TO_BACKGROUND: 0x4204,
  NO_OP_4214: 0x4214,
  DRAW_PIXEL: 0xa002,
  SAVE_ZONE: 0xa054,
  RESTORE_ZONE: 0xa064,
  DRAW_LINE: 0xa0a4,
  DRAW_RECT: 0xa104,
  DRAW_RECT_OUTLINE: 0xa114,
  DRAW_CIRCLE: 0xa404,
  DRAW_CIRCLE_OUTLINE: 0xa424,
  DRAW_SPRITE: 0xa504,
  DRAW_SPRITE_STRETCHED: 0xa506,
  DRAW_SPRITE_FLIPPED: 0xa514,
  DRAW_SPRITE_FLIPPED_STRETCHED: 0xa516,
  DRAW_SPRITE_MIRRORED: 0xa524,
  DRAW_SPRITE_MIRRORED_STRETCHED: 0xa526,
  DRAW_SPRITE_MIRRORED_FLIPPED: 0xa534,
  DRAW_SPRITE_MIRRORED_FLIPPED_STRETCHED: 0xa536,
  MARK_ZONE_DIRTY: 0xa601,
  COPY_SURFACE_RECT: 0xb606,
  PLAY_SAMPLE: 0xc051,
  STOP_SAMPLE: 0xc061,
  LOAD_SCREEN: 0xf01f,
  LOAD_IMAGE: 0xf02f,
  LOAD_PALETTE: 0xf05f,
} as const;
```

If step 2 found a different meaning for one of these, name it after the finding instead.

In `src/ttm/interpreter.ts`, update the renamed case labels so it still compiles: `DRAW_BACKGROUND` → `FREE_IMAGES`, `TTM_UNKNOWN_1` → `SET_ZONE_SLOT`, `SET_FRAME1` → `MIRROR_NEXT_LOAD`, `TIMER` → `RANDOM_DELAY`, `COPY_ZONE_TO_BG` → `COPY_TO_BACKGROUND`, `SAVE_IMAGE1` → `NO_OP_4214`, `DRAW_SPRITE_FLIP` → `DRAW_SPRITE_MIRRORED`, `CLEAR_SCREEN` → `MARK_ZONE_DIRTY`, `DRAW_SCREEN` → `COPY_SURFACE_RECT`. Change nothing else there.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm exec vitest run src/decode src/ttm`
Expected: all pass (the `uses only opcodes our TTM opcode table names` test still finds every used opcode).

- [x] **Action 2: Commit**

```bash
git add src/ttm/opcodes.ts src/ttm/interpreter.ts
git commit -m "refactor(ttm): name the opcodes after what the original does"
```

## Part B: State, device, runner

- [x] **Action 3: Write the state module**

Create `src/ttm/state.ts`:

```ts
import type { TtmResource } from '../decode/ttm-loader.js';
import type { ClipRect, DrawState, Surface } from '../gfx/gdi/surface.js';
import { SCREEN_H, SCREEN_W } from '../types.js';

export const BMP_SLOTS = 6;
export const PALETTE_SLOTS = 6;
export const ZONE_SLOTS = 12;

export interface Bitmaps {
  images: Surface[];
  mirrored: boolean;
}

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TtmSlot {
  id: number;
  ttm: TtmResource | null;
  bitmaps: (Bitmaps | null)[];
  palettes: (Uint8Array | null)[];
  zones: (Zone | null)[];
}

export interface TtmThread {
  slot: TtmSlot;
  isRunning: 0 | 1 | 2;
  sceneSlot: number;
  sceneTag: number;
  sceneTimer: number;
  sceneIterations: number;
  delay: number;
  timer: number;
  tagPage: number;
  page: number;
  nextPage: number;
  replay: boolean;
  purged: boolean;
  paletteSlot: number;
  bmpSlot: number;
  zoneSlot: number;
  foreground: number;
  background: number;
  clipOn: boolean;
  clip: ClipRect;
}

const wholeScreen = (): ClipRect => ({ x1: 0, y1: 0, x2: SCREEN_W - 1, y2: SCREEN_H - 1 });

export function makeTtmSlot(id: number, ttm: TtmResource | null): TtmSlot {
  return {
    id,
    ttm,
    bitmaps: new Array<Bitmaps | null>(BMP_SLOTS).fill(null),
    palettes: new Array<Uint8Array | null>(PALETTE_SLOTS).fill(null),
    zones: new Array<Zone | null>(ZONE_SLOTS).fill(null),
  };
}

export function makeThread(slot: TtmSlot = makeTtmSlot(0, null)): TtmThread {
  return {
    slot,
    isRunning: 0,
    sceneSlot: 0,
    sceneTag: 0,
    sceneTimer: 0,
    sceneIterations: 0,
    delay: 0,
    timer: 0,
    tagPage: 0,
    page: 0,
    nextPage: -1,
    replay: false,
    purged: false,
    paletteSlot: 0,
    bmpSlot: 0,
    zoneSlot: 0,
    foreground: 0x0f,
    background: 0x0f,
    clipOn: true,
    clip: wholeScreen(),
  };
}

export function zoneId(slotId: number, zone: number): number {
  return slotId * ZONE_SLOTS + zone;
}

export function loadThreadDrawState(thread: TtmThread, draw: DrawState): void {
  draw.foreground = thread.foreground;
  draw.background = thread.background;
  draw.clipOn = thread.clipOn;
  draw.clip = { ...thread.clip };
}

export function resetDrawClip(draw: DrawState): void {
  draw.clipOn = true;
  draw.clip = wholeScreen();
}
```

`makeThread` takes its values from `1048:0b3e`; `loadThreadDrawState` from the start of a thread's run in `1048:1acb`; `resetDrawClip` from its end.

- [x] **Action 4: Write the device interface**

Create `src/ttm/device.ts`:

```ts
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
```

Each method stands for one callee of the original (overview, `Trace format`); drawing methods read the shared `DrawState` (foreground, background, fill, clip) the runner keeps in `TtmEnv.draw`, as the original's callees read `1068:1ea3`..`1068:1eae`.

- [x] **Action 5: Write the recorder**

Create `src/testing/ttm-recorder.ts`:

```ts
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
```

- [x] **Action 6: Write the failing unit tests**

Create `src/ttm/page-runner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TtmResource } from '../decode/ttm-loader.js';
import { makeDrawState, makeSurface } from '../gfx/gdi/surface.js';
import { makePalette } from '../gfx/palette.js';
import type { ParsedArchive } from '../resource/types.js';
import { RecordingDevice } from '../testing/ttm-recorder.js';
import { OP } from './opcodes.js';
import { activatePendingPalette, makeTtmEnv, pageOfTag, randomDelay, runTtmPage } from './page-runner.js';
import { loadThreadDrawState, makeThread, makeTtmSlot } from './state.js';

const CLIP = [1, 0, 0, 639, 479];
const word = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const op = (opcode: number, ...args: number[]) => [opcode, ...args].flatMap(word);
const opText = (opcode: number, text: string) => {
  const field = [...text].map((c) => c.charCodeAt(0)).concat(0);
  return [...word(opcode), ...field, ...(field.length % 2 ? [0] : [])];
};
const archiveWith = (...names: string[]): ParsedArchive => ({
  byName: new Map(names.map((name) => [name, { name, type: name.slice(-4), payload: new Uint8Array() }])),
  list: [],
});

function ttm(...pages: number[][]): TtmResource {
  const bytecode: number[] = [];
  const pageOffsets: number[] = [];
  for (const page of pages) {
    pageOffsets.push(bytecode.length);
    bytecode.push(...page, ...op(OP.UPDATE));
  }
  return { pageCount: pages.length, bytecode: Uint8Array.from(bytecode), pageOffsets, tags: [] };
}

function setup(resource: TtmResource, archive: ParsedArchive = archiveWith()) {
  const draw = makeDrawState();
  const device = new RecordingDevice(draw, archive);
  const env = makeTtmEnv(device, draw);
  const thread = makeThread(makeTtmSlot(1, resource));
  const run = (page = 0, replay = false) => {
    device.events = [];
    thread.replay = replay;
    loadThreadDrawState(thread, draw);
    return runTtmPage(env, thread, page);
  };
  return { draw, device, env, thread, run };
}

const drawnRects = (x: number, y: number, w: number, h: number, clip = CLIP) => [
  ['dirty', 1, 0, 0, x, y, w, h, ...clip],
  ['dirty', 1, 0, 1, x, y, w, h, ...clip],
  ['dirty', 2, 1, 0, x, y, w, h, ...clip],
];

describe('runTtmPage', () => {
  it('runs one page and stops at 0x0FF0', () => {
    // SCRANTIC 1058:040c
    const { run } = setup(ttm(op(OP.SET_DELAY, 7), op(OP.SET_DELAY, 9)));
    expect(run(0)).toEqual({ ran: true, delay: 7, gotoPage: null, purge: false });
    expect(run(1).delay).toBe(9);
  });

  it('does not run a page that does not exist', () => {
    // SCRANTIC 1050:074a
    const { run } = setup(ttm(op(OP.SET_DELAY, 7)));
    expect(run(1).ran).toBe(false);
    expect(run(-1).ran).toBe(false);
  });

  it('offsets both line corners by the island position and marks the line dirty', () => {
    // SCRANTIC 1058:0608 1058:0179 1058:119e 1050:0a85
    const { env, device, run } = setup(ttm(op(OP.DRAW_LINE, 1, 2, 3, 4)));
    env.islandX = 7;
    env.islandY = 5;
    run();
    expect(device.events).toEqual([['line', 1, 8, 7, 10, 9, 15, ...CLIP], ...drawnRects(8, 7, 10, 4)]);
  });

  it('offsets only the first corner of a rect and never the zone of 0xa601', () => {
    // SCRANTIC 1058:0614 1058:0620 1058:01a9 1058:11f0
    const { env, device, run } = setup(ttm([...op(OP.DRAW_RECT, 1, 2, 30, 40), ...op(OP.MARK_ZONE_DIRTY, 0)]));
    env.islandX = 7;
    env.islandY = 5;
    run();
    expect(device.events).toEqual([['rect', 1, 8, 7, 30, 40, 1, 15, 15, ...CLIP], ...drawnRects(8, 7, 38, 42)]);
  });

  it('draws circles from the height and marks an odd rect', () => {
    // SCRANTIC 1058:01c4 1058:01bd 1058:1132
    const { device, run } = setup(ttm([...op(OP.DRAW_CIRCLE, 10, 20, 30, 30), ...op(OP.DRAW_CIRCLE_OUTLINE, 0, 0, 99, 9)]));
    run();
    expect(device.events.filter(([event]) => event === 'circle')).toEqual([
      ['circle', 1, 15, 25, 35, 1, 15, 15, ...CLIP],
      ['circle', 1, 4, 4, 4, 0, 15, 15, ...CLIP],
    ]);
    expect(device.events[1]).toEqual(['dirty', 1, 0, 0, -10, 20, 78, 31, ...CLIP]);
  });

  it('keeps the whole color byte and passes the pixel color sign-extended', () => {
    // SCRANTIC 1058:06a9 1058:022c 1058:1195
    const { thread, device, run } = setup(ttm([...op(OP.SET_COLORS, 207, 207), ...op(OP.DRAW_PIXEL, 3, 4)]));
    run();
    expect([thread.foreground, thread.background]).toEqual([207, 207]);
    expect(device.events).toEqual([['pixel', 1, 3, 4, -49, ...CLIP], ...drawnRects(3, 4, 8, 1)]);
  });

  it('draws a sprite from the slot named by the instruction, flags from the opcode', () => {
    // SCRANTIC 1058:025b 1058:10b7
    const { thread, device, run } = setup(ttm(op(OP.DRAW_SPRITE_MIRRORED, 5, 6, 0, 2)));
    thread.slot.bitmaps[2] = { images: [makeSurface(10, 4)], mirrored: false };
    run();
    expect(device.events).toEqual([['sprite', 1, '?', -1, 5, 6, 2, ...CLIP], ...drawnRects(5, 6, 10, 6)]);
  });

  it('skips a sprite whose slot or image is missing, without a dirty rect', () => {
    // SCRANTIC 1058:025b 1058:10b7
    const { device, run } = setup(ttm([...op(OP.DRAW_SPRITE, 5, 6, 0, 2), ...op(OP.DRAW_SPRITE, 5, 6, 3, 0)]));
    run();
    expect(device.events).toEqual([]);
  });

  it('clears nothing on 0xa601 and marks a saved zone dirty', () => {
    // SCRANTIC 1058:02d8 1058:1158
    const { thread, device, run } = setup(ttm([...op(OP.MARK_ZONE_DIRTY, 1), ...op(OP.MARK_ZONE_DIRTY, 0)]));
    thread.slot.zones[1] = { x: 10, y: 20, w: 30, h: 40 };
    run();
    expect(device.events).toEqual(drawnRects(10, 20, 30, 40));
  });

  it('saves and restores zone 0 on the first run only, and still marks the rect', () => {
    // SCRANTIC 1058:0144 1058:1510 1058:1747 1058:1801
    const { thread, device, run } = setup(ttm(op(OP.SAVE_ZONE, 194, 123, 175, 142), op(OP.RESTORE_ZONE, 1, 1, 1, 1)));
    run(0);
    expect(device.events).toEqual([['save', 1, 194, 123, 175, 142], ...drawnRects(194, 123, 183, 144)]);
    expect(thread.slot.zones[0]).toEqual({ x: 194, y: 123, w: 175, h: 142 });
    run(1);
    expect(device.events[0]).toEqual(['restore', 1, 194, 123, 175, 142]);
    run(0, true);
    expect(device.events).toEqual(drawnRects(194, 123, 183, 144));
  });

  it('loads images on the first run only, with the mirror flag of 0x2012', () => {
    // SCRANTIC 1058:0f23 1058:0769
    const { env, device, run } = setup(ttm([...op(OP.MIRROR_NEXT_LOAD, 0, 0), ...opText(OP.LOAD_IMAGE, 'x.bmp')]));
    run();
    expect(device.events).toEqual([['bitmaps', 'x.bmp', 1]]);
    expect(env.mirrorNextLoad).toBe(false);
    run(0, true);
    expect(device.events).toEqual([]);
  });

  it('uses the shared walk bitmaps for JOHNWALK.BMP, in any case', () => {
    // SCRANTIC 1058:07a6 1068:27d2
    const { device, run } = setup(ttm(opText(OP.LOAD_IMAGE, 'JohnWalk.bmp')));
    run();
    expect(device.events).toEqual([]);
  });

  it('loads a screen, copies B into C, drops the C-to-B list, and marks the whole screen at the end', () => {
    // SCRANTIC 1058:06c5 1050:0b31 1050:0b74 1058:1212
    const { device, run } = setup(ttm(opText(OP.LOAD_SCREEN, 'ISLETEMP.SCR')));
    run();
    expect(device.events).toEqual([
      ['screen', 1, 'ISLETEMP.SCR'],
      ['copy', 1, 2, 0, 0, 640, 480],
      ['drop', 2, 1, 0],
      ['dirty', 1, 0, 0, 0, 0, 640, 480, 0, 0, 0, 639, 479],
    ]);
  });

  it('copies a rect between numbered surfaces', () => {
    // SCRANTIC 1058:0eb4 1058:14e0
    const { device, run } = setup(ttm(op(OP.COPY_SURFACE_RECT, 149, 111, 242, 171, 2, 1)));
    run();
    expect(device.events).toEqual([['copy', 2, 1, 149, 111, 242, 171]]);
  });

  it('copies a rect into the background and marks it once', () => {
    // SCRANTIC 1058:0e55 1050:0b74
    const { device, run } = setup(ttm(op(OP.COPY_TO_BACKGROUND, 1, 2, 3, 4)));
    run();
    expect(device.events).toEqual([['copy', 1, 2, 1, 2, 3, 4], ['dirty', 1, 0, 0, 1, 2, 3, 4, ...CLIP]]);
  });

  it('sets an inclusive clip on the thread', () => {
    // SCRANTIC 1058:0f40
    const { thread, draw, run } = setup(ttm(op(OP.SET_CLIP_ZONE, 10, 20, 30, 40)));
    run();
    expect(thread.clip).toEqual({ x1: 10, y1: 20, x2: 30, y2: 40 });
    expect([draw.clipOn, draw.clip]).toEqual([true, { x1: 10, y1: 20, x2: 30, y2: 40 }]);
  });

  it('plays a sample on the first run only, also through 0x1301', () => {
    // SCRANTIC 1058:040c 1058:0063
    const { device, run } = setup(ttm(op(OP.PLAY_SAMPLE_ALIAS, 3)));
    run();
    expect(device.events).toEqual([['sound', 3]]);
    run(0, true);
    expect(device.events).toEqual([]);
  });

  it('goes to the first page that starts with the tag', () => {
    // SCRANTIC 1058:0fc3 1058:13a9
    const resource = ttm(op(OP.GOTO_TAG, 7), [...op(OP.SET_DELAY, 1), ...op(OP.TAG, 7)], op(OP.LOCAL_TAG, 7));
    expect(pageOfTag(resource, 7)).toBe(2);
    expect(pageOfTag(resource, 8)).toBe(-1);
    expect(setup(resource).run().gotoPage).toBe(2);
  });

  it('cancels a purge raised inside a page call and offsets its drawing', () => {
    // SCRANTIC 1058:0f7f 1058:05a1 1058:05ad
    const { device, run } = setup(ttm(op(OP.CALL_PAGE, 3, 4, 9), [...op(OP.TAG, 9), ...op(OP.PURGE), ...op(OP.DRAW_PIXEL, 1, 1)]));
    expect(run(0).purge).toBe(false);
    expect(device.events[0]).toEqual(['pixel', 1, 4, 5, 15, ...CLIP]);
    expect(run(1).purge).toBe(true);
  });

  it('keeps drawings in B after 0x0500 by not restoring them from C', () => {
    // SCRANTIC 1058:0fd2 1058:0fda 1050:0a85
    const { device, run } = setup(ttm([...op(OP.KEEP_DRAWINGS), ...op(OP.DRAW_PIXEL, 0, 0), ...op(OP.ERASE_DRAWINGS), ...op(OP.DRAW_PIXEL, 0, 0)]));
    run();
    expect(device.events.filter(([event]) => event === 'dirty')).toHaveLength(5);
  });

  it('makes a loaded palette pending, and active at the end of the tick', () => {
    // SCRANTIC 1058:0995 1058:0952 1050:0799
    const { env, thread, device, run } = setup(ttm(opText(OP.LOAD_PALETTE, 'JOHNCAST.PAL')), archiveWith('JOHNCAST.PAL'));
    run();
    expect(device.paletteName(env.pendingPalette)).toBe('JOHNCAST.PAL');
    expect(thread.slot.palettes[0]).toBe(env.pendingPalette);
    env.pendingPalette!.fill(9);
    const palette = makePalette();
    activatePendingPalette(env, palette);
    expect([palette[0], palette[3], env.pendingPalette]).toEqual([9, 0xff, null]);
  });
});

describe('randomDelay', () => {
  it('adds the remainder of an unsigned divide to the low bound', () => {
    // SCRANTIC 1058:0e08
    expect(randomDelay(4661, 10, 30)).toBe(11);
    expect(randomDelay(4660, 10, 30)).toBe(10);
    expect(randomDelay(5, 30, 10)).toBe(35);
  });
});
```

- [x] **Action 7: Run them to make sure they fail**

Run: `pnpm exec vitest run src/ttm/page-runner.test.ts`
Expected: FAIL, `Cannot find module './page-runner.js'` (or the recorder's import of it).

- [x] **Action 8: Write the runner**

Create `src/ttm/page-runner.ts`:

```ts
import { readTtmInstruction } from '../decode/ttm-bytecode.js';
import type { TtmResource } from '../decode/ttm-loader.js';
import { SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import type { DrawState } from '../gfx/gdi/surface.js';
import { setPaletteColors } from '../gfx/palette.js';
import { SCREEN_H, SCREEN_W, type Palette } from '../types.js';
import type { TtmDevice } from './device.js';
import { OP } from './opcodes.js';
import { zoneId, type TtmThread } from './state.js';

export interface TtmEnv {
  device: TtmDevice;
  draw: DrawState;
  islandX: number;
  islandY: number;
  pendingPalette: Uint8Array | null;
  mirrorNextLoad: boolean;
  keepDrawings: boolean;
}

export interface PageResult {
  ran: boolean;
  delay: number | null;
  gotoPage: number | null;
  purge: boolean;
}

interface Run {
  delay: number | null;
  gotoPage: number | null;
  purge: boolean;
  screenLoaded: boolean;
  callDepth: number;
  callX: number;
  callY: number;
}

const WALK_BITMAPS = 'JOHNWALK.BMP';
const SPRITE_OPCODES: ReadonlySet<number> = new Set([
  OP.DRAW_SPRITE,
  OP.DRAW_SPRITE_STRETCHED,
  OP.DRAW_SPRITE_FLIPPED,
  OP.DRAW_SPRITE_FLIPPED_STRETCHED,
  OP.DRAW_SPRITE_MIRRORED,
  OP.DRAW_SPRITE_MIRRORED_STRETCHED,
  OP.DRAW_SPRITE_MIRRORED_FLIPPED,
  OP.DRAW_SPRITE_MIRRORED_FLIPPED_STRETCHED,
]);

const int8 = (value: number) => (value << 24) >> 24;
const int16 = (value: number) => (value << 16) >> 16;
const isDrawOpcode = (opcode: number) => (opcode & 0xf000) === 0xa000;
const isStretched = (opcode: number) => (opcode & 0x0f) === 6;

export function makeTtmEnv(device: TtmDevice, draw: DrawState): TtmEnv {
  return { device, draw, islandX: 0, islandY: 0, pendingPalette: null, mirrorNextLoad: false, keepDrawings: false };
}

export function runTtmPage(env: TtmEnv, thread: TtmThread, page: number): PageResult {
  const run: Run = { delay: null, gotoPage: null, purge: false, screenLoaded: false, callDepth: 0, callX: 0, callY: 0 };
  const ran = runPage(env, thread, page, run);
  return { ran, delay: run.delay, gotoPage: run.gotoPage, purge: run.purge };
}

export function pageOfTag(ttm: TtmResource, tag: number): number {
  for (let page = 0; page < ttm.pageOffsets.length; page++) {
    const first = readTtmInstruction(ttm.bytecode, ttm.pageOffsets[page]!);
    if ((first.opcode === OP.TAG || first.opcode === OP.LOCAL_TAG) && first.args[0] === tag) return page;
  }
  return -1;
}

export function randomDelay(random: number, low: number, high: number): number {
  const remainder = int16((random & 0xffff) % ((high - low) & 0xffff));
  return int16(low + Math.abs(remainder));
}

export function activatePendingPalette(env: TtmEnv, palette: Palette): void {
  if (!env.pendingPalette) return;
  setPaletteColors(palette, env.pendingPalette);
  env.pendingPalette = null;
}

function runPage(env: TtmEnv, thread: TtmThread, page: number, run: Run): boolean {
  const ttm = thread.slot.ttm;
  if (!ttm || page < 0 || page >= ttm.pageCount || page >= ttm.pageOffsets.length) return false;
  run.gotoPage = null;
  let offset = ttm.pageOffsets[page]!;
  for (;;) {
    const instruction = readTtmInstruction(ttm.bytecode, offset);
    offset = instruction.next;
    const opcode = remap(instruction.opcode);
    if (opcode === OP.UPDATE) break;
    env.device.setSurfaces(SURFACE_B, SURFACE_B);
    const args = instruction.args.map(int16);
    applyOffsets(env, run, opcode, args);
    if ((opcode & 0xf000) === 0xc000) {
      if (!thread.replay && opcode === OP.PLAY_SAMPLE) env.device.playSound(args[0]!);
    } else if (isDrawOpcode(opcode)) {
      drawOpcode(env, thread, opcode, args);
    } else {
      controlOpcode(env, thread, run, opcode, args, instruction.text ?? '');
    }
    if (isDrawOpcode(opcode)) markDrawn(env, thread, opcode, args);
  }
  if (run.screenLoaded) {
    const clipOn = env.draw.clipOn;
    env.draw.clipOn = false;
    env.device.addDirtyRect(0, 0, SCREEN_W, SCREEN_H, SURFACE_B, SURFACE_A, 0);
    env.draw.clipOn = clipOn;
    run.screenLoaded = false;
  }
  return true;
}

function remap(opcode: number): number {
  if (opcode === OP.PLAY_SAMPLE_ALIAS) return OP.PLAY_SAMPLE;
  if (opcode === OP.STOP_SAMPLE_ALIAS) return OP.STOP_SAMPLE;
  return opcode;
}

function applyOffsets(env: TtmEnv, run: Run, opcode: number, args: number[]): void {
  if (opcode === OP.MARK_ZONE_DIRTY) return;
  if (run.callDepth > 0 && isDrawOpcode(opcode)) shift(args, run.callX, run.callY, opcode === OP.DRAW_LINE);
  const islandOpcode = isDrawOpcode(opcode) || opcode === OP.SET_CLIP_ZONE || opcode === OP.COPY_TO_BACKGROUND;
  if (islandOpcode && (env.islandX !== 0 || env.islandY !== 0)) {
    shift(args, env.islandX, env.islandY, opcode === OP.DRAW_LINE || opcode === OP.SET_CLIP_ZONE);
  }
}

function shift(args: number[], dx: number, dy: number, bothCorners: boolean): void {
  args[0] = int16((args[0] ?? 0) + dx);
  args[1] = int16((args[1] ?? 0) + dy);
  if (!bothCorners) return;
  args[2] = int16((args[2] ?? 0) + dx);
  args[3] = int16((args[3] ?? 0) + dy);
}

function drawOpcode(env: TtmEnv, thread: TtmThread, opcode: number, args: number[]): void {
  const { device, draw } = env;
  const [x = 0, y = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0] = args;
  switch (opcode) {
    case OP.DRAW_PIXEL:
      device.setPixel(x, y, int8(draw.foreground));
      return;
    case OP.DRAW_LINE:
      device.drawLine(x, y, a2, a3);
      return;
    case OP.DRAW_RECT:
    case OP.DRAW_RECT_OUTLINE:
      draw.fill = opcode === OP.DRAW_RECT;
      device.drawRect(x, y, a2, a3);
      draw.fill = true;
      return;
    case OP.DRAW_CIRCLE:
    case OP.DRAW_CIRCLE_OUTLINE: {
      draw.fill = opcode === OP.DRAW_CIRCLE;
      const r = a3 >> 1;
      device.drawCircle(r, int16(x + r), int16(y + r));
      draw.fill = true;
      return;
    }
    case OP.SAVE_ZONE:
    case OP.RESTORE_ZONE:
      if (!thread.replay && a2 > 0 && a3 > 0 && x + a2 <= SCREEN_W && y + a3 <= SCREEN_H) zoneEffect(env, thread, opcode, x, y, a2, a3);
      return;
  }
  if (!SPRITE_OPCODES.has(opcode)) return;
  const bitmaps = thread.slot.bitmaps[a3];
  const image = bitmaps?.images[a2];
  if (!bitmaps || !image) return;
  const flags = (opcode >> 4) & 0x0f;
  if (isStretched(opcode)) device.drawSpriteStretched(image, x, y, flags, a4, a5);
  else device.drawSprite(image, bitmaps.mirrored, x, y, flags);
}

function zoneEffect(env: TtmEnv, thread: TtmThread, opcode: number, x: number, y: number, w: number, h: number): void {
  const { device } = env;
  const slot = thread.slot;
  if (opcode === OP.SAVE_ZONE) {
    slot.zones[0] = { x, y, w, h };
    device.setSurfaces(SURFACE_B, SURFACE_A);
    device.saveZone(zoneId(slot.id, 0), x, y, w, h);
  } else {
    const zone = slot.zones[0];
    device.setSurfaces(SURFACE_B, SURFACE_B);
    if (zone) device.restoreZone(zoneId(slot.id, 0), zone.x, zone.y, zone.w, zone.h);
  }
  device.setSurfaces(SURFACE_B, SURFACE_B);
}

function markDrawn(env: TtmEnv, thread: TtmThread, opcode: number, args: number[]): void {
  const [x = 0, y = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0] = args;
  switch (opcode) {
    case OP.DRAW_PIXEL:
      addDrawnRect(env, x, y, 8, 1);
      return;
    case OP.DRAW_LINE:
      addDrawnRect(env, Math.min(x, a2), Math.min(y, a3), Math.abs(x - a2) + 8, Math.abs(y - a3) + 2);
      return;
    case OP.DRAW_CIRCLE:
    case OP.DRAW_CIRCLE_OUTLINE:
      addDrawnRect(env, x - 20, y, a2 + 48, a3 + 1);
      return;
    case OP.MARK_ZONE_DIRTY: {
      const zone = thread.slot.zones[x];
      if (zone) addDrawnRect(env, zone.x, zone.y, zone.w, zone.h);
      return;
    }
  }
  if (SPRITE_OPCODES.has(opcode)) {
    const image = thread.slot.bitmaps[a3]?.images[a2];
    if (!image) return;
    if (isStretched(opcode)) addDrawnRect(env, x, y, a4, a5);
    else if (image.width !== 0) addDrawnRect(env, x, y, image.width, image.height + 2);
    return;
  }
  addDrawnRect(env, x, y, a2 + 8, a3 + 2);
}

function addDrawnRect(env: TtmEnv, x: number, y: number, w: number, h: number): void {
  const [left, top, width, height] = [x, y, w, h].map(int16) as [number, number, number, number];
  env.device.addDirtyRect(left, top, width, height, SURFACE_B, SURFACE_A, 0);
  env.device.addDirtyRect(left, top, width, height, SURFACE_B, SURFACE_A, 1);
  if (!env.keepDrawings) env.device.addDirtyRect(left, top, width, height, SURFACE_C, SURFACE_B, 0);
}

function controlOpcode(env: TtmEnv, thread: TtmThread, run: Run, opcode: number, args: number[], text: string): void {
  const { device, draw } = env;
  const slot = thread.slot;
  const replay = thread.replay;
  const [a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0] = args;
  switch (opcode) {
    case OP.SCREEN_TO_BACKGROUND:
      if (!replay) screenToBackground(env, run);
      return;
    case OP.FREE_PALETTE:
      if (replay) return;
      if (slot.palettes[thread.paletteSlot] === env.pendingPalette) env.pendingPalette = null;
      slot.palettes[thread.paletteSlot] = null;
      return;
    case OP.FREE_IMAGES:
      if (!replay) slot.bitmaps[thread.bmpSlot] = null;
      return;
    case OP.FREE_ZONE:
      if (!replay) slot.zones[thread.zoneSlot] = null;
      return;
    case OP.PURGE:
      run.purge = true;
      return;
    case OP.KEEP_DRAWINGS:
      env.keepDrawings = true;
      return;
    case OP.ERASE_DRAWINGS:
      env.keepDrawings = false;
      return;
    case OP.SET_DELAY:
      run.delay = a0;
      return;
    case OP.SET_BMP_SLOT:
      thread.bmpSlot = a0;
      return;
    case OP.SET_PALETTE_SLOT:
      thread.paletteSlot = a0;
      if (!replay) env.pendingPalette = slot.palettes[a0] ?? null;
      return;
    case OP.SET_ZONE_SLOT:
      thread.zoneSlot = a0;
      return;
    case OP.GOTO_TAG: {
      const page = slot.ttm ? pageOfTag(slot.ttm, a0 & 0xffff) : -1;
      run.gotoPage = page < 0 ? null : page;
      return;
    }
    case OP.SET_COLORS:
      thread.foreground = draw.foreground = a0 & 0xff;
      thread.background = draw.background = a1 & 0xff;
      return;
    case OP.MIRROR_NEXT_LOAD:
      if (!replay) env.mirrorNextLoad = true;
      return;
    case OP.RANDOM_DELAY:
      if (!replay) run.delay = randomDelay(device.random(), a0, a1);
      return;
    case OP.CALL_PAGE:
      callPage(env, thread, run, a0, a1, a2);
      return;
    case OP.DIRTY_SCREEN:
      if (!replay) addDrawnRect(env, 0, 0, SCREEN_W, SCREEN_H);
      return;
    case OP.SET_CLIP_ZONE:
      thread.clipOn = draw.clipOn = true;
      thread.clip = { x1: a0, y1: a1, x2: a2, y2: a3 };
      draw.clip = { ...thread.clip };
      return;
    case OP.COPY_TO_BACKGROUND:
      if (replay) return;
      copyToBackground(env, a0, a1, a2, a3);
      device.addDirtyRect(a0, a1, a2, a3, SURFACE_B, SURFACE_A, 0);
      return;
    case OP.COPY_SURFACE_RECT:
      if (replay) return;
      device.setSurfaces(surfaceByNumber(a4), surfaceByNumber(a5));
      device.copyRect(a0, a1, a2, a3);
      device.setSurfaces(SURFACE_A, SURFACE_B);
      return;
    case OP.LOAD_SCREEN:
      if (replay) return;
      device.loadScreen(text);
      screenToBackground(env, run);
      return;
    case OP.LOAD_IMAGE:
      if (!replay) loadImage(env, thread, text);
      return;
    case OP.LOAD_PALETTE: {
      if (replay) return;
      const palette = device.loadPalette(text);
      slot.palettes[thread.paletteSlot] = palette;
      env.pendingPalette = palette;
      return;
    }
  }
}

function callPage(env: TtmEnv, thread: TtmThread, run: Run, x: number, y: number, tag: number): void {
  run.callDepth++;
  run.callX = x;
  run.callY = y;
  const purgedBefore = run.purge;
  const page = thread.slot.ttm ? pageOfTag(thread.slot.ttm, tag & 0xffff) : -1;
  if (page >= 0) runPage(env, thread, page, run);
  if (!purgedBefore) run.purge = false;
  run.callDepth--;
}

function screenToBackground(env: TtmEnv, run: Run): void {
  run.screenLoaded = true;
  copyToBackground(env, 0, 0, SCREEN_W, SCREEN_H);
  env.device.dropDirtyList(SURFACE_C, SURFACE_B, 0);
}

function copyToBackground(env: TtmEnv, x: number, y: number, w: number, h: number): void {
  env.device.setSurfaces(SURFACE_B, SURFACE_C);
  env.device.copyRect(x, y, w, h);
  env.device.setSurfaces(SURFACE_B, SURFACE_B);
}

function surfaceByNumber(n: number): number {
  if (n === 0) return SURFACE_A;
  if (n === 2) return SURFACE_C;
  return SURFACE_B;
}

function loadImage(env: TtmEnv, thread: TtmThread, name: string): void {
  thread.slot.bitmaps[thread.bmpSlot] = name.toUpperCase() === WALK_BITMAPS ? env.device.walkBitmaps() : env.device.loadBitmaps(name, env.mirrorNextLoad);
  env.mirrorNextLoad = false;
}
```

Where step 2's findings differ from this code (an argument order, an offset exception, a skip-on-replay check), follow the findings and adjust the matching unit test; note each change in the commit message.

- [x] **Action 9: Run the unit tests**

Run: `pnpm exec vitest run src/ttm/page-runner.test.ts`
Expected: all pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [x] **Action 10: Commit**

```bash
git add src/ttm/state.ts src/ttm/device.ts src/ttm/page-runner.ts src/ttm/page-runner.test.ts src/testing/ttm-recorder.ts
git commit -m "feat(ttm): port the original page runner"
```

## Part C: Whole corpus against the original

- [x] **Action 11: Write the data test**

Create `src/ttm/page-runner.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { traceTtm } from '../testing/ttm-recorder.js';

describe.skipIf(!hasFixture('ttm/traces.tsv'))('TTM page runner matches the original SCRANTIC.SCR', () => {
  it('makes the same calls and results on every page of every TTM script, first run and replay', () => {
    // SCRANTIC 1050:074a 1058:040c 1058:0000 1058:0144 1058:1510 1050:0a85 1050:0b31 1050:0b74
    const archive = loadArchive();
    const original = new Map<string, string[]>();
    for (const [ttm, page, pass, event, values] of readFixtureRows('ttm/traces.tsv')) {
      if (!original.has(ttm!)) original.set(ttm!, []);
      original.get(ttm!)!.push([page, pass, event, values ?? ''].join('\t'));
    }
    expect(original.size).toBe(41);
    const wrong: string[] = [];
    for (const [name, rows] of original) {
      const ours = traceTtm(archive, name);
      const at = ours.findIndex((row, i) => row !== rows[i]);
      if (at >= 0) wrong.push(`${name} row ${at}: ours ${ours[at]}; original ${rows[at] ?? '(end)'}`);
      else if (ours.length !== rows.length) wrong.push(`${name}: ours ${ours.length} rows, original ${rows.length}`);
    }
    expect(wrong).toEqual([]);
  });
});
```

- [x] **Action 12: Run it and fix every difference**

Run: `pnpm exec vitest run src/ttm/page-runner.data.test.ts`
Expected: pass. If it is skipped, `re/fixtures/ttm/traces.tsv` is missing: run `re/.venv/bin/python -I scripts/re/unicorn/dump_ttm.py` (step 3).

For each difference, decide from the assembly which side is wrong. A wrong runner gets fixed (and gets a unit test with its address). A wrong recorder or tracer (a value formatted differently, a row the format does not describe) gets fixed in `src/testing/ttm-recorder.ts` or `scripts/re/unicorn/original_ttm.py`; if the tracer changes, rerun the dump and the Unicorn tests. Never paper over a difference by skipping rows.

- [x] **Action 13: Commit**

```bash
git add src/ttm/page-runner.data.test.ts src/ttm/page-runner.ts src/ttm/page-runner.test.ts src/testing/ttm-recorder.ts
git commit -m "test(ttm): page runner equals the original on every TTM page"
```

## Part D: Findings

- [x] **Action 14: Checklist rows and OQ-23**

In `docs/re/ttm.md`, `Side-by-side checklist`, add one row each (use the real line numbers of `src/ttm/page-runner.ts`; status `fixed` where our old interpreter did something else, `match` where it already agreed):

- `1050:074a` `ttm_runPageChecked` → `runTtmPage` / `runPage` (the page checks).
- `1058:040c` `ttm_runPage` → `runPage`.
- `1058:0000` `ttm_soundOpcode` → the `0xc000` branch of `runPage`.
- `1058:0144` `ttm_drawOpcode` → `drawOpcode`.
- `1058:1510` `ttm_effectOpcode` → `zoneEffect` (only `0xa054`/`0xa064`; the other effects are OQ-27).
- `1058:13a9` `ttm_pageOfTag` → `pageOfTag`.
- `1058:14e0` `ttm_surfaceByNumber` → `surfaceByNumber`.
- `1058:1949` `ttm_effectCopy` → none (only reached by effects in OQ-27).
- `1050:0a85` `ttm_markDrawn` → `addDrawnRect`.
- `1050:0b31` `ttm_screenToBackground` → `screenToBackground`.
- `1050:0b74` `ttm_copyToBackground` → `copyToBackground`.
- `1050:0799` `ttm_activatePendingPalette` → `activatePendingPalette`.

Add to `docs/re/open-questions.md`, under `## Not reviewed on purpose`:

```markdown
### OQ-23: Page-runner guards where the original misbehaves

- **Where:** `src/ttm/page-runner.ts`
- **What it does:** a page call (`0x3003`) or goto for a tag no page starts with does nothing; a sprite index past the end of its list draws nothing; `0x2022` with equal bounds divides by zero and gives `NaN`; a page without `0x0FF0` throws when the bytecode ends.
- **Original:** `1058:0f7f` runs `1058:040c(0xFFFF)` and reads a page pointer from before the table; `1058:025b` reads past the zero-terminated list; `1058:0e08` faults on `DIV` by 0; `1058:040c` reads past the bytecode.
- **Why not reviewed:** none of these happens in the data: no `0x3003`, every goto tag exists (the trace comparison passes), sprite indices stay inside their lists, no `0x2022` with equal bounds, and every page ends with `0x0FF0` (`src/decode/ttm-loader.data.test.ts`).
- **Status:** open, by choice
```

Check the "every goto tag exists" claim before writing it: `rg "\tresult\t1 -?[0-9]+ -1 " re/fixtures/ttm/traces.tsv` lists runs with no goto; compare with the pages that contain `0x1201` (or count `goto -1` results on pages whose bytecode has `0x1201`). If a goto does miss, write that instead.

- [x] **Action 15: Run everything and commit**

Run: `pnpm exec tsc --noEmit`, then `pnpm test`
Expected: all pass.

```bash
git add docs/re/ttm.md docs/re/open-questions.md
git commit -m "docs(re): page runner checklist rows"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
