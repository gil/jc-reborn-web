# Step 6: Island Port

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-003-story-port.md` (`StoryRandom`, `StoryWorld`, `IslandFlags`), `step-005-original-island-trace.md` (fixture)

**Files:**

- Rename: `src/island/island.ts` → `src/island/legacy-island.ts` (kept only until step 7 rewires the story; update the imports in `src/story/story.ts` and `src/main.ts`)
- Delete: `src/island/island.data.test.ts` (it tests the legacy island; the new data test replaces it)
- Create: `src/island/island.ts`, `src/island/island-device.ts`, `src/engine/timers.ts`, `src/testing/island-recorder.ts`
- Test: `src/island/island.test.ts`, `src/island/island.data.test.ts` (new), `src/engine/timers.test.ts`
- Modify: `docs/re/island.md` (checklist), `docs/re/open-questions.md` (OQ-24 resolved)

**Interfaces:**

- Consumes: `docs/re/island.md` (steps 4, 5); fixture `re/fixtures/island/traces.tsv` (overview, `Trace formats`, `Island`); from step 3: `StoryRandom` (`next()`, `discard(n)`, `percent(...w)`, `writeIndex`), `RandomSource`, `makeStoryWorld(random): StoryWorld` (`world.island: IslandFlags { place; lowTide; mode; still; noRaft; holidayShown }`, `world.sequence.slot`, `world.sequence.holiday`, `world.days.numDays`), `MODE_ISLAND`, `MODE_NO_ISLAND`, `NO_PLACE`, `NO_TIDE`; from earlier chunks: `Display`, `SURFACE_A/B/C`, `COPY_RECT`, `drawSprite`, `spriteSurface`, `MIRROR`, `drawLine`, `drawRect`, `makeDrawState`, `rawIndices`, `ClipRect`, `Surface`, `decodeBmp`, `decodeScr`, `hasCorpus`, `hasFixture`, `loadArchive`, `readFixtureRows`.
- Produces (step 7 relies on these exact names):
  - `src/engine/timers.ts`: `interface Timers { now: number; idleWait: number; surf: number; waves: number }`, `makeTimers(): Timers`, `clockTick(timers)`.
  - `src/island/island-device.ts`: `interface SpriteSheet { name: string; images: Surface[] }`; `interface IslandDevice { loadSheet(name): SpriteSheet | null; loadScreen(name): void; setSource(surface): void; setTarget(surface): void; fillRect(x, y, w, h, color): void; drawSprite(sheet, index, x, y, flags): void; drawLine(x1, y1, x2, y2, color): void; copyRect(x, y, w, h): void; addDirtyRect(x, y, w, h, source, target, age): void; dirtyOverlaps(x, y, w, h, target, age): boolean; setClip(clip: ClipRect | null): void }`; `class DisplayIslandDevice implements IslandDevice` (`constructor(display, archive)`).
  - `src/island/island.ts`: `interface IslandSettings { background: boolean; clouds: boolean; waves: boolean }`; `interface Drifter { x; y; frame; kind; period; countdown }`; `interface Island { device; world; timers; settings; speed; background; raft; holidays; x; y; raftFrame; surf; wind; clouds; cloudCount; cloudsLeft; waves; waveCount; wavesLeft }`; `makeIsland(device, world, timers, settings): Island`; `drawIsland(island): boolean`; `animateIsland(island, first)`; `drawHoliday(island, full)`; `redrawIslandOver(island, image, x, y, scenery)`; `rectOverlap(...)`; `ttmOffset(island, left): { x: number; y: number }`; `drawIntro(device)`.
  - `src/testing/island-recorder.ts`: `class RecordingIslandDevice implements IslandDevice` (`events: (string | number)[][]`), `traceIslandCase(archive, k): string[]`, `ISLAND_CASES = 24`, `ISLAND_STEPS = 60`.

The code blocks follow the overview's first reading. Where `docs/re/island.md` says otherwise, follow it; the data test is the judge.

## Part A: Clock timers

- [x] **Action 1: Write the failing test**

Create `src/engine/timers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clockTick, makeTimers } from './timers.js';

describe('clock callback', () => {
  it('adds 1 to the clock and counts every non-zero timer down', () => {
    // SCRANTIC 1008:16c2
    const timers = { ...makeTimers(), idleWait: 2, surf: 1, waves: 0 };
    clockTick(timers);
    expect(timers).toEqual({ now: 1, idleWait: 1, surf: 0, waves: 0 });
  });

  it('wraps the clock at 32 bits', () => {
    // SCRANTIC 1008:16c2
    const timers = { ...makeTimers(), now: 0xffffffff };
    clockTick(timers);
    expect(timers.now).toBe(0);
  });
});
```

Run: `pnpm exec vitest run src/engine/timers.test.ts`
Expected: FAIL, cannot resolve `./timers.js`.

- [x] **Action 2: Write `src/engine/timers.ts`**

```ts
export interface Timers {
  now: number;
  idleWait: number;
  surf: number;
  waves: number;
}

export function makeTimers(): Timers {
  return { now: 0, idleWait: 0, surf: 0, waves: 0 };
}

export function clockTick(timers: Timers): void {
  timers.now = (timers.now + 1) >>> 0;
  if (timers.idleWait !== 0) timers.idleWait--;
  if (timers.surf !== 0) timers.surf--;
  if (timers.waves !== 0) timers.waves--;
}
```

`1068:30d4` (walk frame delay) belongs to chunk 8 and `1068:3f2c` has no other user (`docs/re/story.md`, `Timing`); neither is modeled. If `story.md` says `3f2c` is used, add it.

Run: `pnpm exec vitest run src/engine/timers.test.ts`
Expected: PASS.

- [x] **Action 3: Commit**

```bash
git add src/engine/timers.ts src/engine/timers.test.ts
git commit -m "feat(engine): the original clock callback"
```

## Part B: Device and recorder

- [x] **Action 4: Move the legacy island aside**

Run: `git mv src/island/island.ts src/island/legacy-island.ts`
Run: `git rm src/island/island.data.test.ts`

In `src/story/story.ts` and `src/main.ts`, change `'../island/island.js'` / `'./island/island.js'` to `'../island/legacy-island.js'` / `'./island/legacy-island.js'`.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [x] **Action 5: Write `src/island/island-device.ts`**

```ts
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
```

The island keeps its own `DrawState`: the original shares the clip and colors with the TTM runner, but every TTM page loads its node's colors and clip first (`docs/re/ads.md`, `Tick`), and `1010:1551` restores the clip it set.

- [x] **Action 6: Write `src/testing/island-recorder.ts`**

```ts
import { SURFACE_A } from '../gfx/gdi/display.js';
import type { ClipRect } from '../gfx/gdi/surface.js';
import { drawHoliday, drawIsland, animateIsland, makeIsland, type Island } from '../island/island.js';
import { loadSheet, type IslandDevice, type SpriteSheet } from '../island/island-device.js';
import { clockTick, makeTimers } from '../engine/timers.js';
import type { ParsedArchive } from '../resource/types.js';
import { StoryRandom } from '../story/random.js';
import { makeStoryWorld } from '../story/sequence.js';
import { SCREEN_H, SCREEN_W } from '../types.js';

export const ISLAND_CASES = 24;
export const ISLAND_STEPS = 60;
const PLACES = [0xffff, 0, 1, 2, 0x10, 0x14, 0x24, 0x28, 0x0c, 0x30];

type Event = (string | number)[];

export class RecordingIslandDevice implements IslandDevice {
  readonly events: Event[] = [];
  private source = SURFACE_A;
  private target = SURFACE_A;
  private clip: ClipRect | null = null;
  private overlapCalls = 0;

  constructor(private readonly archive: ParsedArchive) {}

  restart(): void {
    this.events.length = 0;
    this.overlapCalls = 0;
  }

  loadSheet(name: string): SpriteSheet | null {
    this.events.push(['sheet', name]);
    return loadSheet(this.archive, name);
  }

  loadScreen(name: string): void {
    this.events.push(['screen', this.target, name]);
  }

  setSource(surface: number): void {
    this.source = surface;
  }

  setTarget(surface: number): void {
    this.target = surface;
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    this.events.push(['fill', this.target, x, y, w, h, color]);
  }

  drawSprite(sheet: SpriteSheet, index: number, x: number, y: number, flags: number): void {
    const clip = this.clip ? [1, this.clip.x1, this.clip.y1, this.clip.x2, this.clip.y2] : [0, 0, 0, SCREEN_W - 1, SCREEN_H - 1];
    this.events.push(['sprite', this.target, sheet.name, index, x, y, flags, ...clip]);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, color: number): void {
    this.events.push(['line', this.target, x1, y1, x2, y2, color]);
  }

  copyRect(x: number, y: number, w: number, h: number): void {
    this.events.push(['copy', this.source, this.target, x, y, w, h]);
  }

  addDirtyRect(x: number, y: number, w: number, h: number, source: number, target: number, age: number): void {
    this.events.push(['dirty', source, target, age, x, y, w, h]);
  }

  dirtyOverlaps(x: number, y: number, w: number, h: number, target: number, age: number): boolean {
    const answer = this.overlapCalls++ % 3 === 1;
    this.events.push(['overlaps', target, age, x, y, w, h, answer ? 1 : 0]);
    return answer;
  }

  setClip(clip: ClipRect | null): void {
    this.clip = clip;
  }
}

function stateRow(island: Island, random: StoryRandom): (string | number)[] {
  const flags = island.world.island;
  const record = (d: { x: number; y: number; frame: number; kind: number; period: number; countdown: number }) =>
    [d.x, d.y, d.frame, d.kind, d.period, d.countdown].join(',');
  return [
    island.x, island.y, flags.lowTide, flags.place, island.raftFrame, ...island.surf, island.wind,
    island.timers.surf, island.timers.waves, ...island.cloudsLeft, ...island.wavesLeft, random.writeIndex,
    ...island.clouds.map(record), ...island.waves.map(record),
  ];
}

export function traceIslandCase(archive: ParsedArchive, k: number): string[] {
  const device = new RecordingIslandDevice(archive);
  const random = new StoryRandom();
  const world = makeStoryWorld(random);
  const timers = makeTimers();
  const island = makeIsland(device, world, timers, { background: true, clouds: true, waves: true });
  drawIsland(island);
  Object.assign(world.island, {
    mode: [0, 0, 0, 1, 2][k % 5]!,
    place: PLACES[k % PLACES.length]!,
    lowTide: [0xffff, 0, 1][k % 3]!,
    still: k % 7 === 3,
    noRaft: k % 6 === 5,
    holidayShown: k % 4 !== 2,
  });
  world.sequence.holiday = k % 5;
  world.sequence.slot = k % 2 ? 13 : 0;
  world.days.numDays = [1, 3, 9][k % 3]!;
  island.settings = { background: k % 8 !== 7, clouds: k % 9 !== 8, waves: k % 10 !== 9 };
  island.speed = k % 2 === 0 ? 200 : 0;
  random.discard(997 * k);
  const rows: string[] = [];
  const flush = (step: number) => {
    for (const [event, ...values] of device.events) rows.push([k, step, event, values.join(' ')].join('\t'));
    rows.push([k, step, 'state', stateRow(island, random).join(' ')].join('\t'));
    device.events.length = 0;
  };
  device.restart();
  drawIsland(island);
  flush(-1);
  for (let step = 0; step < ISLAND_STEPS; step++) {
    for (let i = 0; i < 1 + (step % 4); i++) clockTick(timers);
    animateIsland(island, false);
    drawHoliday(island, false);
    flush(step);
  }
  return rows;
}
```

## Part C: The island

- [x] **Action 7: Write the failing tests**

Create `src/island/island.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeTimers } from '../engine/timers.js';
import { SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { makeSurface, type ClipRect } from '../gfx/gdi/surface.js';
import { StoryRandom } from '../story/random.js';
import { makeStoryWorld, MODE_NO_ISLAND } from '../story/sequence.js';
import type { IslandDevice, SpriteSheet } from './island-device.js';
import { drawHoliday, drawIsland, makeIsland, rectOverlap, redrawIslandOver, ttmOffset } from './island.js';

class FakeDevice implements IslandDevice {
  readonly drawn: (string | number)[][] = [];
  clip: ClipRect | null = null;
  overlaps = false;
  private target = SURFACE_A;
  loadSheet(name: string): SpriteSheet {
    return { name, images: Array.from({ length: 42 }, () => makeSurface(10, 10)) };
  }
  loadScreen(name: string): void { this.drawn.push(['screen', this.target, name]); }
  setSource(): void {}
  setTarget(surface: number): void { this.target = surface; }
  fillRect(x: number, y: number, w: number, h: number, color: number): void { this.drawn.push(['fill', this.target, x, y, w, h, color]); }
  drawSprite(sheet: SpriteSheet, index: number, x: number, y: number, flags: number): void {
    this.drawn.push(['sprite', this.target, sheet.name, index, x, y, flags, this.clip ? 1 : 0]);
  }
  drawLine(): void {}
  copyRect(x: number, y: number, w: number, h: number): void { this.drawn.push(['copy', x, y, w, h]); }
  addDirtyRect(): void {}
  dirtyOverlaps(): boolean { return this.overlaps; }
  setClip(clip: ClipRect | null): void { this.clip = clip; }
}

function island() {
  const device = new FakeDevice();
  const world = makeStoryWorld(new StoryRandom());
  const isle = makeIsland(device, world, makeTimers(), { background: true, clouds: true, waves: true });
  expect(drawIsland(isle)).toBe(true);
  device.drawn.length = 0;
  return { device, world, isle };
}

describe('island', () => {
  it('only loads its bitmaps on the first call', () => {
    // SCRANTIC 1010:0136 1008:143c
    const device = new FakeDevice();
    const isle = makeIsland(device, makeStoryWorld(new StoryRandom()), makeTimers(), { background: true, clouds: true, waves: true });
    drawIsland(isle);
    expect(device.drawn).toEqual([]);
    expect(isle.background?.name).toBe('BACKGRND.BMP');
    expect(isle.raft?.name).toBe('MRAFT.BMP');
  });

  it('draws the island into C, then copies C to B', () => {
    // SCRANTIC 1010:0136
    const { device, isle } = island();
    drawIsland(isle);
    expect(device.drawn[0]![1]).toBe(SURFACE_C);
    expect(device.drawn).toContainEqual(['sprite', SURFACE_C, 'BACKGRND.BMP', 0, isle.x + 0x121, isle.y + 0x117, 0, 0]);
    expect(device.drawn).toContainEqual(['copy', 0, 0, 640, 480]);
  });

  it('fills the screen with color 5 and draws no island in no-island mode', () => {
    // SCRANTIC 1010:0136
    const { device, world, isle } = island();
    world.island.mode = MODE_NO_ISLAND;
    drawIsland(isle);
    expect(device.drawn[0]).toEqual(['fill', SURFACE_C, 0, 0, 640, 480, 5]);
    expect(device.drawn.filter((event) => event[0] === 'sprite' && event[3] === 0 && event[2] === 'BACKGRND.BMP')).toEqual([]);
  });

  it('places the island at fixed spots for the low and left places', () => {
    // SCRANTIC 1010:1b00
    const { world, isle } = island();
    world.island.place = 2;
    drawIsland(isle);
    expect([isle.x, isle.y]).toEqual([0, 299 - 0x117]);
    world.island.place = 1;
    drawIsland(isle);
    expect([isle.x, isle.y]).toEqual([0x11 - 0x121, 0x135 - 0x117]);
  });

  it('offsets TTM drawing by the island position plus one, or plus 0x111 for left scenes', () => {
    // SCRANTIC 1010:00fc
    const { world, isle } = island();
    isle.x = -20;
    isle.y = 7;
    expect(ttmOffset(isle, false)).toEqual({ x: -19, y: 7 });
    expect(ttmOffset(isle, true)).toEqual({ x: -20 + 0x111, y: 7 });
    world.island.mode = MODE_NO_ISLAND;
    expect(ttmOffset(isle, true)).toEqual({ x: 0, y: 0 });
  });

  it('redraws the holiday sprite only when a presented rect overlaps it', () => {
    // SCRANTIC 1010:1e50
    const { device, world, isle } = island();
    world.sequence.holiday = 1;
    drawIsland(isle);
    device.drawn.length = 0;
    drawHoliday(isle, false);
    expect(device.drawn).toEqual([]);
    device.overlaps = true;
    drawHoliday(isle, false);
    expect(device.drawn).toEqual([['sprite', SURFACE_B, 'HOLIDAY.BMP', 0, isle.x + 0x19b, isle.y + 0x12a, 0, 0]]);
  });

  it('redraws only the palm trunk over a walking Johnny, clipped to him', () => {
    // SCRANTIC 1010:1551
    const { device, isle } = island();
    redrawIslandOver(isle, makeSurface(20, 40), isle.x + 0x1bb, isle.y + 0x94, false);
    expect(device.drawn).toEqual([['sprite', SURFACE_B, 'BACKGRND.BMP', 13, isle.x + 0x1bb, isle.y + 0x94, 0, 1]]);
    expect(device.clip).toBeNull();
  });
});

describe('rect overlap', () => {
  it('is 2 inside, 1 touching, 0 apart', () => {
    // SCRANTIC 1010:1a88
    expect(rectOverlap(10, 10, 5, 5, 0, 0, 100, 100)).toBe(2);
    expect(rectOverlap(95, 10, 10, 5, 0, 0, 100, 100)).toBe(1);
    expect(rectOverlap(200, 10, 5, 5, 0, 0, 100, 100)).toBe(0);
  });
});
```

Create the new `src/island/island.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Display, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { makeTimers } from '../engine/timers.js';
import { StoryRandom } from '../story/random.js';
import { makeStoryWorld } from '../story/sequence.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { ISLAND_CASES, traceIslandCase } from '../testing/island-recorder.js';
import { DisplayIslandDevice } from './island-device.js';
import { animateIsland, drawIsland, makeIsland } from './island.js';

describe.skipIf(!hasFixture('island/traces.tsv'))('island matches the original SCRANTIC.SCR', () => {
  it('draws and animates the same way in every case', { timeout: 120_000 }, () => {
    // SCRANTIC 1010:0136 1010:040e 1010:1e50 1010:0e74 1010:1d69 1010:0a38 1010:0b67 1010:04a2 1010:1551 1010:1b00 1010:14bf
    const archive = loadArchive();
    const original = new Map<number, string[]>();
    for (const [k, step, event, values] of readFixtureRows('island/traces.tsv')) {
      const key = Number(k);
      if (!original.has(key)) original.set(key, []);
      original.get(key)!.push([k, step, event, values ?? ''].join('\t'));
    }
    expect([...original.keys()]).toEqual(Array.from({ length: ISLAND_CASES }, (_, k) => k));
    const wrong: string[] = [];
    for (const [k, rows] of original) {
      const ours = traceIslandCase(archive, k);
      const at = ours.findIndex((row, i) => row !== rows[i]);
      if (at >= 0) wrong.push(`case ${k} row ${at}: ours ${ours[at]}; original ${rows[at] ?? '(end)'}`);
      else if (ours.length !== rows.length) wrong.push(`case ${k}: ours ${ours.length} rows, original ${rows.length}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe.skipIf(!hasCorpus)('island on the display', () => {
  it('draws the island into C, copies it to B, and presents it through the restore pass', () => {
    // SCRANTIC 1010:0136 1060:03d3
    const display = new Display();
    display.screenIsB = true;
    const island = makeIsland(new DisplayIslandDevice(display, loadArchive()), makeStoryWorld(new StoryRandom()), makeTimers(), { background: true, clouds: true, waves: true });
    drawIsland(island);
    drawIsland(island);
    expect(display.surfaces[SURFACE_C]!.pixels.some((index) => index !== 0)).toBe(true);
    expect(display.surfaces[SURFACE_B]!.pixels).toEqual(display.surfaces[SURFACE_C]!.pixels);
    display.restorePass(0);
    expect(display.window.pixels).toEqual(display.surfaces[SURFACE_B]!.pixels);
    const before = display.surfaces[SURFACE_B]!.pixels.slice();
    island.timers.surf = 0;
    animateIsland(island, false);
    expect(display.surfaces[SURFACE_B]!.pixels).not.toEqual(before);
  });
});
```

Run: `pnpm exec vitest run src/island`
Expected: FAIL, cannot resolve `./island.js`.

- [x] **Action 8: Write `src/island/island.ts`**

```ts
import type { Timers } from '../engine/timers.js';
import { SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { MIRROR } from '../gfx/gdi/sprite.js';
import type { Surface } from '../gfx/gdi/surface.js';
import { MODE_ISLAND, MODE_NO_ISLAND, NO_PLACE, NO_TIDE, type StoryWorld } from '../story/sequence.js';
import { SCREEN_H, SCREEN_W } from '../types.js';
import type { IslandDevice, SpriteSheet } from './island-device.js';

export interface IslandSettings {
  background: boolean;
  clouds: boolean;
  waves: boolean;
}

export interface Drifter {
  x: number;
  y: number;
  frame: number;
  kind: number;
  period: number;
  countdown: number;
}

export interface Island {
  device: IslandDevice;
  world: StoryWorld;
  timers: Timers;
  settings: IslandSettings;
  speed: number;
  background: SpriteSheet | null;
  raft: SpriteSheet | null;
  holidays: SpriteSheet | null;
  x: number;
  y: number;
  raftFrame: number;
  surf: [number, number, number];
  wind: number;
  clouds: Drifter[];
  cloudCount: number;
  cloudsLeft: [number, number, number];
  waves: Drifter[];
  waveCount: number;
  wavesLeft: [number, number, number, number];
}

type Spot = readonly [x: number, y: number, w: number, h: number, sprite: number, counter: number];

const OCEANS = ['OCEAN00.SCR', 'OCEAN01.SCR', 'OCEAN02.SCR'];
const NIGHT = 'NIGHT.SCR';
const NIGHT_SLOT = 12;
const FILL_COLOR = 5;
const GLINT_COLOR = 15;
const ISLAND_X = 0x121;
const ISLAND_Y = 0x117;
const NO_SPRITE = -1;
const SURF_PERIOD = 4;
const SURF_FRAMES = 3;
const WAVE_PERIOD = 10;
const CLOUD_RECORDS = 15;
const WAVE_RECORDS = 30;
const LAST_RAFT = 5;
const TTM_LEFT = 0x110;

const HIGH_TIDE_SURF: readonly Spot[] = [[0x10f, 0x132, 0x48, 0x1d, 3, 0], [0x16d, 0x13f, 0x9c, 0x19, 6, 1], [0x207, 0x12f, 0x41, 0x20, 9, 2]];
const LOW_TIDE_SURF: readonly Spot[] = [
  [0xea, 0x143, 0x78, 0x30, 30, 0], [0x170, 0x164, 0xab, 0x1c, 33, 1], [0x22f, 0x143, 0x51, 0x30, 36, 2], [0x82, 0x154, 0x61, 0x1d, 39, 0],
];
const HOLIDAY_SPOTS: Readonly<Record<number, readonly [sprite: number, x: number, y: number, w: number, h: number]>> = {
  1: [0, 0x19b, 0x12a, 0x28, 0x22],
  2: [2, 0x195, 0x10b, 0x38, 0x41],
  3: [3, 0x16a, 0x9b, 0x98, 0x2f],
  4: [1, 0x14e, 0x11e, 0x80, 0x30],
};
const CLOUD_SPRITES = [15, 16, 17];
const WAVE_FRAMES: readonly (readonly number[])[] = [[18, 19, 20, 21, 20, 19, 18], [22, 23, 24, 25, 24, 23, 22], [26, 27, 28, 29, 28, 27, 26]];
const WAVE_AREAS: readonly (readonly [x: number, y: number, w: number, h: number])[] = [
  [-10, 0xf9, 0x28a, 0x28], [-40, 0x121, 0x2a8, 0x5d], [-70, 0x17e, 0x2c6, 0x8e],
];
const GLINT = 0;
const SMALL = 0;
const MEDIUM = 1;
const LARGE = 2;

const drifter = (): Drifter => ({ x: 0, y: 0, frame: 0, kind: 0, period: 0, countdown: 0 });

export function makeIsland(device: IslandDevice, world: StoryWorld, timers: Timers, settings: IslandSettings): Island {
  return {
    device, world, timers, settings, speed: 0,
    background: null, raft: null, holidays: null,
    x: 0, y: 0, raftFrame: 0, surf: [0, 0, 0], wind: 1,
    clouds: Array.from({ length: CLOUD_RECORDS }, drifter), cloudCount: 0, cloudsLeft: [0, 0, 0],
    waves: Array.from({ length: WAVE_RECORDS }, drifter), waveCount: 0, wavesLeft: [0, 0, 0, 0],
  };
}

export function drawIntro(device: IslandDevice): void {
  device.setSource(SURFACE_B);
  device.setTarget(SURFACE_B);
  device.loadScreen('INTRO.SCR');
  device.setTarget(SURFACE_A);
  device.copyRect(0, 0, SCREEN_W, SCREEN_H);
}

export function drawIsland(island: Island): boolean {
  const { device, world } = island;
  const flags = world.island;
  if (world.sequence.holiday !== 0 && !island.holidays) island.holidays = device.loadSheet('HOLIDAY.BMP');
  if (!island.background) {
    island.background = device.loadSheet('BACKGRND.BMP');
    island.raft = device.loadSheet('MRAFT.BMP');
    if (!island.background) island.cloudCount = island.waveCount = 0;
    return island.background !== null && island.raft !== null;
  }
  device.setTarget(SURFACE_C);
  if (!island.settings.background || flags.mode === MODE_NO_ISLAND) device.fillRect(0, 0, SCREEN_W, SCREEN_H, FILL_COLOR);
  else if (flags.mode === MODE_ISLAND && world.sequence.slot < NIGHT_SLOT) device.loadScreen(OCEANS[island.world.random.next() % OCEANS.length]!);
  else device.loadScreen(NIGHT);
  if (flags.lowTide === NO_TIDE) flags.lowTide = island.world.random.next() & 1;
  placeIsland(island);
  island.x -= ISLAND_X;
  island.y -= ISLAND_Y;
  if (flags.mode !== MODE_NO_ISLAND) {
    drawRaft(island, true);
    sprite(island, 0, 0x121, 0x117);
    if (flags.lowTide === 1) {
      sprite(island, 1, 0xfa, 0x12f);
      sprite(island, 2, 0x97, 0x148);
    }
    island.timers.surf = 0;
    island.surf = [2, 2, 2];
    drawSurf(island);
    sprite(island, 14, 0x18d, 0x117);
    sprite(island, 13, 0x1bb, 0x94);
    sprite(island, 12, 0x16e, 0x7a);
  }
  device.setSource(SURFACE_C);
  device.setTarget(SURFACE_B);
  device.copyRect(0, 0, SCREEN_W, SCREEN_H);
  device.addDirtyRect(0, 0, SCREEN_W, SCREEN_H, SURFACE_B, SURFACE_A, 0);
  island.waveCount = !island.settings.waves || flags.still ? 0 : WAVE_RECORDS;
  resetOceanWaves(island);
  island.cloudCount = island.settings.clouds ? CLOUD_RECORDS : 0;
  initClouds(island);
  animateIsland(island, true);
  drawHoliday(island, true);
  return true;
}

export function animateIsland(island: Island, first: boolean): void {
  const flags = island.world.island;
  if (flags.mode === MODE_NO_ISLAND) return;
  island.device.setTarget(SURFACE_B);
  island.device.setSource(SURFACE_C);
  animateOceanWaves(island);
  if (first) animateClouds(island);
  if (!first && flags.still) return;
  drawSurf(island);
  drawRaft(island, false);
}

export function ttmOffset(island: Island, left: boolean): { x: number; y: number } {
  if (island.world.island.mode === MODE_NO_ISLAND) return { x: 0, y: 0 };
  return { x: island.x + 1 + (left ? TTM_LEFT : 0), y: island.y };
}

export function drawHoliday(island: Island, full: boolean): void {
  const flags = island.world.island;
  const spot = HOLIDAY_SPOTS[island.world.sequence.holiday];
  if (!spot || !island.holidays || !flags.holidayShown || flags.mode === MODE_NO_ISLAND) return;
  const [index, dx, dy, w, h] = spot;
  const x = island.x + dx;
  const y = island.y + dy;
  if (full || island.device.dirtyOverlaps(x, y, w, h, SURFACE_A, 0)) island.device.drawSprite(island.holidays, index, x, y, 0);
}

export function rectOverlap(x: number, y: number, w: number, h: number, rx: number, ry: number, rw: number, rh: number): number {
  const inside = !(x < rx || rx + rw <= x + w || y < ry || ry + rh <= y + h);
  const touches = !(x + w < rx || rx + rw <= x || y + h < ry || ry + rh <= y);
  return Number(inside) + Number(touches);
}

export function redrawIslandOver(island: Island, image: Surface, x: number, y: number, scenery: boolean): void {
  const { device } = island;
  const w = image.width;
  const h = image.height;
  const over = (rx: number, ry: number, rw: number, rh: number) => rectOverlap(x, y, w, h, island.x + rx, island.y + ry, rw, rh) !== 0;
  const under = ([rx, ry, rw, rh]: Spot) => rectOverlap(x, y + h, w, 1, island.x + rx, island.y + ry, rw, rh) !== 0;
  device.setClip({ x1: x, y1: y, x2: x + w, y2: y + h });
  if (!scenery) {
    if (y + h < island.y + 0x125 && over(0x1bb, 0x94, 0x16, 0x91)) sprite(island, 13, 0x1bb, 0x94);
  } else {
    if (over(0, 0xd6, 0x280, 0x10a)) {
      if (island.world.island.lowTide === 1) {
        if (over(0x97, 0x148, 0x39, 0x1e)) sprite(island, 2, 0x97, 0x148);
        if (under(LOW_TIDE_SURF[3]!)) drawSurfSpot(island, LOW_TIDE_SURF[3]!);
        if (over(0x121, 0x117, 0x117, 0x33)) sprite(island, 0, 0x121, 0x117);
        if (over(0xfa, 0x12f, 0x17c, 0x45)) sprite(island, 1, 0xfa, 0x12f);
        for (const spot of LOW_TIDE_SURF.slice(0, 3)) if (under(spot)) drawSurfSpot(island, spot);
      } else {
        if (over(0x121, 0x117, 0x117, 0x33)) sprite(island, 0, 0x121, 0x117);
        for (const spot of HIGH_TIDE_SURF) if (under(spot)) drawSurfSpot(island, spot);
      }
    }
    if (over(0x1bb, 0x94, 0x16, 0x91)) sprite(island, 13, 0x1bb, 0x94);
    if (over(0x16e, 0x7a, 0x94, 0x45)) sprite(island, 12, 0x16e, 0x7a);
    if (over(0x18d, 0x117, 0x68, 0x26)) sprite(island, 14, 0x18d, 0x117);
  }
  device.setClip(null);
}

function sprite(island: Island, index: number, dx: number, dy: number): void {
  if (island.background) island.device.drawSprite(island.background, index, island.x + dx, island.y + dy, 0);
}

function image(island: Island, index: number): Surface | undefined {
  return island.background?.images[index];
}

function randomPlace(island: Island, spriteIndex: number, xBase: number, yBase: number, xRange: number, yRange: number): [number, number] {
  const { random } = island.world;
  if (spriteIndex !== NO_SPRITE) {
    const picture = image(island, spriteIndex)!;
    xRange -= picture.width;
    yRange -= picture.height;
  }
  if (xRange < 0 || yRange < 0) return [0, 0];
  const x = xBase + (xRange === 0 ? 0 : random.next() % xRange);
  const y = yBase + (yRange === 0 ? 0 : random.next() % yRange);
  return [x, y];
}

function placeIsland(island: Island): void {
  const flags = island.world.island;
  if (flags.place === NO_PLACE) flags.place = 0;
  const place = flags.place;
  if (place & 2) {
    [island.x, island.y] = [0x121, 299];
    return;
  }
  if (place & 1) {
    [island.x, island.y] = [0x11, 0x135];
    return;
  }
  let [left, width, height]: [number, number, number] = flags.lowTide === 1 ? [0xa8, 0x6f, 0x3b] : [0x43, 0xe2, 0x81];
  let top = 0xff;
  if (place !== 0) {
    if (place === 0x10 || place === 0x20 || place === 0x30) top = Math.trunc(height / 2) + 0xff;
    if (!((place & 4 && place & 0x10) || (place & 8 && place & 0x20))) height = Math.trunc(height / 2);
    if (place === 8 || place === 0x20 || place === 0x28) left += Math.trunc(width / 2);
    if (!((place & 4 && place & 8) || (place & 0x10 && place & 0x20))) width = Math.trunc(width / 2);
  }
  [island.x, island.y] = randomPlace(island, NO_SPRITE, left, top, width, height);
}

function drawRaft(island: Island, full: boolean): void {
  if (full) island.raftFrame = Math.min(Math.max(island.world.days.numDays - 1, 1), LAST_RAFT);
  const flags = island.world.island;
  if (!island.raft || island.raftFrame === 0 || flags.noRaft) return;
  const index = island.raftFrame - 1;
  const picture = island.raft.images[index];
  if (!picture) return;
  const [x, y]: [number, number] = flags.lowTide === 0 ? [island.x + 0x201, island.y + 0x10a] : [island.x + 0x212, island.y + 0x119];
  if (!full && !island.device.dirtyOverlaps(x, y, picture.width, picture.height, SURFACE_A, 0)) return;
  island.device.drawSprite(island.raft, index, x, y, 0);
  if (!full) redrawIslandOver(island, picture, x, y, true);
}

function surfSpots(island: Island): readonly Spot[] {
  return island.world.island.lowTide === 0 ? HIGH_TIDE_SURF : LOW_TIDE_SURF;
}

function drawSurfSpot(island: Island, [dx, dy, , , base, counter]: Spot): void {
  sprite(island, base + island.surf[counter]!, dx, dy);
}

function drawSurf(island: Island): void {
  let advanced = false;
  if (island.timers.surf === 0) {
    island.timers.surf = SURF_PERIOD;
    const surf = island.surf;
    if (surf[0] === surf[2]) surf[0]++;
    else if (surf[1] === surf[0]) surf[2]++;
    else surf[1]++;
    for (let i = 0; i < surf.length; i++) if (surf[i]! >= SURF_FRAMES) surf[i] = 0;
    advanced = true;
  }
  for (const spot of surfSpots(island)) {
    const [dx, dy, w, h] = spot;
    const x = island.x + dx;
    const y = island.y + dy;
    if (!advanced && !island.device.dirtyOverlaps(x, y, w, h, SURFACE_A, 0)) continue;
    drawSurfSpot(island, spot);
    island.device.addDirtyRect(x, y, w, h, SURFACE_B, SURFACE_A, 0);
    if (island.world.island.still) island.device.addDirtyRect(x, y, w, h, SURFACE_B, SURFACE_C, 0);
  }
}

function count(counts: number[], index: number, by: number): void {
  counts[index] = counts[index]! + by;
}

function setCloud(island: Island, cloud: Drifter, kind: number, xBase: number, xRange: number): void {
  cloud.kind = kind;
  count(island.cloudsLeft, kind, -1);
  [cloud.x, cloud.y] = randomPlace(island, CLOUD_SPRITES[kind]!, xBase, 1, xRange, 0x8b);
}

function initClouds(island: Island): void {
  const { random } = island.world;
  island.cloudsLeft = [8, 4, 2];
  island.wind = random.percent(50) === 0 ? 1 : -1;
  for (const cloud of island.clouds) {
    cloud.x = 0;
    cloud.y = 0;
    if (random.percent(30) === 0) continue;
    const pick = random.percent(5, 10, 15);
    const left = island.cloudsLeft;
    let kind: number | null = null;
    if (pick === 1 && left[LARGE]) kind = LARGE;
    else if ((pick === 1 || pick === 2) && left[MEDIUM]) kind = MEDIUM;
    else if (pick >= 1 && left[SMALL]) kind = SMALL;
    if (kind === null) continue;
    setCloud(island, cloud, kind, 0, SCREEN_W);
    cloud.period = (random.next() % 5) + 6;
    cloud.countdown = random.next() % cloud.period;
    cloud.frame = 0;
  }
}

function animateClouds(island: Island): void {
  const { random } = island.world;
  const { device } = island;
  const active = island.clouds.slice(0, island.cloudCount);
  for (const cloud of active) {
    if (cloud.x !== 0 || cloud.y !== 0) continue;
    const pick = random.percent(20, 30, 50);
    const kind = pick === 1 ? LARGE : pick === 2 ? MEDIUM : pick === 3 ? SMALL : null;
    if (kind === null || island.cloudsLeft[kind] === 0) continue;
    setCloud(island, cloud, kind, island.wind === 1 ? -1000 : SCREEN_W, 1000);
    cloud.countdown = 0;
    cloud.frame = 0;
    cloud.period = (random.next() % 5) + 6;
  }
  for (const cloud of active) {
    if (cloud.x === 0 && cloud.y === 0) continue;
    if (cloud.countdown-- !== 0) continue;
    const picture = image(island, CLOUD_SPRITES[cloud.kind]!)!;
    cloud.countdown = cloud.period;
    device.addDirtyRect(cloud.x, cloud.y, picture.width, picture.height, SURFACE_B, SURFACE_A, 0);
    cloud.x += island.wind;
    if ((island.wind < 0 && cloud.x + picture.width < 0) || (island.wind > 0 && cloud.x > SCREEN_W)) {
      cloud.x = 0;
      cloud.y = 0;
      count(island.cloudsLeft, cloud.kind, 1);
    }
  }
  for (const cloud of active) {
    if (cloud.x === 0 && cloud.y === 0) continue;
    const index = CLOUD_SPRITES[cloud.kind]!;
    const picture = image(island, index)!;
    const due = cloud.countdown === cloud.period || device.dirtyOverlaps(cloud.x, cloud.y, picture.width, picture.height, SURFACE_A, 0);
    if (!due || cloud.x + picture.width <= 0 || cloud.x >= SCREEN_W) continue;
    device.drawSprite(island.background!, index, cloud.x, cloud.y, island.wind < 1 ? 0 : MIRROR);
    device.addDirtyRect(cloud.x, cloud.y, picture.width, picture.height, SURFACE_B, SURFACE_A, 0);
    device.addDirtyRect(cloud.x, cloud.y, picture.width, picture.height, SURFACE_B, SURFACE_C, 0);
    redrawIslandOver(island, picture, cloud.x, cloud.y, true);
  }
}

function resetOceanWaves(island: Island): void {
  island.wavesLeft = [30, 4, 2, 1];
  for (const wave of island.waves) {
    wave.x = 0;
    wave.y = 0;
  }
}

function spawnWave(island: Island, wave: Drifter, pick: number): void {
  const { random } = island.world;
  if (pick === 1) {
    if (!island.wavesLeft[GLINT]) return;
    wave.kind = GLINT;
    wave.period = (random.next() % 30) + 10;
    wave.countdown = wave.period;
    [wave.x, wave.y] = randomPlace(island, NO_SPRITE, 0, 0xd6, 0x280, 0x23);
    const hidden = rectOverlap(wave.x, wave.y, 1, 1, island.x + 0x1bb, island.y + 0x94, 0x16, 0x91) !== 0
      || rectOverlap(wave.x, wave.y, 1, 1, island.x + 0x16e, island.y + 0x7a, 0x94, 0x45) !== 0;
    if (hidden) {
      wave.x = 0;
      wave.y = 0;
    } else {
      island.wavesLeft[GLINT]--;
    }
    return;
  }
  const kind = pick - 1;
  if (kind < 1 || kind > 3 || !island.wavesLeft[kind]) return;
  wave.kind = kind;
  wave.frame = 0;
  wave.period = random.percent(30, 50);
  wave.countdown = wave.period;
  const [x, y, w, h] = WAVE_AREAS[kind - 1]!;
  [wave.x, wave.y] = randomPlace(island, NO_SPRITE, x, y, w, h);
  count(island.wavesLeft, kind, -1);
}

function animateOceanWaves(island: Island): void {
  const { random } = island.world;
  const { device, timers } = island;
  for (const wave of island.waves.slice(0, island.waveCount)) {
    if (wave.x === 0 && wave.y === 0 && random.percent(35) !== 0 && island.speed > 100) spawnWave(island, wave, random.percent(35, 5, 5, 5));
    if (wave.x === 0 && wave.y === 0) continue;
    if (wave.kind === GLINT) {
      device.drawLine(wave.x, wave.y, wave.x + 1, wave.y, GLINT_COLOR);
      device.addDirtyRect(wave.x, wave.y, 1, 1, SURFACE_B, SURFACE_A, 0);
      if (timers.waves === 0 && wave.countdown-- === 0) {
        device.addDirtyRect(wave.x, wave.y, 1, 1, SURFACE_B, SURFACE_A, 1);
        device.addDirtyRect(wave.x, wave.y, 1, 1, SURFACE_C, SURFACE_B, 0);
        wave.x = 0;
        wave.y = 0;
        island.wavesLeft[GLINT]++;
      }
      continue;
    }
    if (timers.waves === 0) {
      wave.x += island.wind;
      if (wave.countdown-- === 0) {
        wave.countdown = wave.period;
        wave.frame++;
      }
    }
    const index = WAVE_FRAMES[wave.kind - 1]![wave.frame];
    if (index === undefined) {
      wave.x = 0;
      wave.y = 0;
      count(island.wavesLeft, wave.kind, 1);
      continue;
    }
    const picture = image(island, index)!;
    const spots = island.world.island.lowTide === 1 ? LOW_TIDE_SURF.slice(0, 3) : HIGH_TIDE_SURF;
    const behindSurf = spots.some(([dx, dy, w, h]) => rectOverlap(wave.x, wave.y, picture.width, picture.height, island.x + dx, island.y + dy, w, h) === 2);
    if (behindSurf) continue;
    device.drawSprite(island.background!, index, wave.x, wave.y, 0);
    redrawIslandOver(island, picture, wave.x, wave.y, true);
    markIslandDrawn(island, wave.x, wave.y, picture.width, picture.height);
  }
  if (timers.waves === 0) timers.waves = WAVE_PERIOD;
}

function markIslandDrawn(island: Island, x: number, y: number, w: number, h: number): void {
  island.device.addDirtyRect(x, y, w, h, SURFACE_B, SURFACE_A, 0);
  island.device.addDirtyRect(x, y, w, h, SURFACE_B, SURFACE_A, 1);
  island.device.addDirtyRect(x, y, w, h, SURFACE_C, SURFACE_B, 0);
}
```

Things in this block to check against `docs/re/island.md` before trusting it:

- `initClouds`: the kind fallbacks (`pick === 1` tries large, then medium, then small; `pick === 2` medium, then small; `pick === 3` small). The `else if` chain above encodes exactly that; confirm with Action 1 item 5 of step 4.
- `animateClouds`, loop 1: the original only takes a kind when its count is non-zero, with no fallback, and draws `1018:1ef5(20, 30, 50)` before checking the count.
- `animateClouds`, loop 2: `countdown--` happens only for clouds on screen, and the test reads the value before the decrement.
- `animateOceanWaves`: the `percent(35)` draw happens before the speed test, so it uses a random number even when the speed is too low.
- The surf counter wrap (`>= SURF_FRAMES` is the same as the original's `> 2`).

- [x] **Action 9: Run the tests**

Run: `pnpm exec vitest run src/island src/engine/timers.test.ts`
Expected: PASS. When the data test fails, its message names the first differing row of each case. Compare the two rows: an extra or missing `overlaps` row means a short-circuit order differs; a `state` row that differs in `random write index` means a random draw is missing or extra; a `sprite` row with a different index or position points at the table it reads. Fix the port, not the fixture.

- [x] **Action 10: Type check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass (the legacy island still serves `src/story/story.ts`).

```bash
git add src/island src/testing/island-recorder.ts src/story/story.ts src/main.ts
git commit -m "feat(island): port the original island drawing and animation"
```

## Part D: Findings and open questions

- [x] **Action 11: Update the checklist and OQ-24**

In `docs/re/island.md`, `Side-by-side checklist`, point every ported row at `src/island/island.ts:<line>` with the function name (lines from `rg -n "^export function|^function" src/island/island.ts`) and status `fixed`: `1010:00fc` `ttmOffset`, `1010:0136` `drawIsland`, `1010:040e` `animateIsland`, `1010:0463` `resetOceanWaves`, `1010:04a2` `animateOceanWaves` and `spawnWave`, `1010:0a38` `initClouds`, `1010:0b67` `animateClouds`, `1010:0e74` `drawSurf` and `drawSurfSpot`, `1010:14bf` `randomPlace`, `1010:1551` `redrawIslandOver`, `1010:1a0d` `markIslandDrawn`, `1010:1a88` `rectOverlap`, `1010:1b00` `placeIsland`, `1010:1d69` `drawRaft`, `1010:1e50` `drawHoliday`. Add the intro drawing of `1008:143c` to `docs/re/story.md`'s checklist row for `1008:143c` as `src/island/island.ts` `drawIntro` (still `open` until step 7 wires the startup).

In `docs/re/open-questions.md`, move OQ-24 to `Resolved`:

```markdown
- **Resolution:** `src/island/island.ts` ports `1010:0136`, `1010:040e`, `1010:1e50` and their helpers through `IslandDevice` (`src/island/island-device.ts`); every case of the island trace matches the original (`src/island/island.data.test.ts`, `docs/re/island.md`, `Emulated`). The left-island offset comes from `1010:1b00` (place bit 1: island at `(0x11, 0x135)`, so offset `(-272, 30)`) and the TTM offset from `1010:00fc` (`+1`, or `+0x111` for scenes with flag `0x400`). Wired into the story in step 7.
- **Status:** resolved (chunk 7)
```

- [x] **Action 12: Commit**

```bash
git add docs/re/island.md docs/re/story.md docs/re/open-questions.md
git commit -m "docs(re): island port checked against the original"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
