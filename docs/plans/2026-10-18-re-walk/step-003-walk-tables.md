# Step 3: Walk Tables

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-002-original-walk-trace.md` (`re/fixtures/walk/walk-data.bin`)

**Files:**

- Create: `scripts/re/walk-data.mjs`, `src/walk/walk-tables.ts` (generated), `src/walk/walk-tables.test.ts`, `src/walk/walk-tables.data.test.ts`
- Do not touch: `src/walk/walk.ts`, `src/walk/walk-data.ts`, `src/walk/calcpath*.ts` (step 4 replaces them; they must keep compiling here)

**Interfaces:**

- Consumes: `re/fixtures/walk/walk-data.bin` (`1068:02e1`..`165f`, 4991 bytes; layout in the overview's `Binary facts`, `Tables`), `hasCorpus`, `hasFixture`, `readFixtureBytes`, `loadArchive` from `src/testing/corpus.ts`, `decodeBmp` from `src/decode/bmp.ts`.
- Produces, in `src/walk/walk-tables.ts`:

```ts
export type WalkFrame = readonly [sprite: number, x: number, y: number];
export type RouteChoice = readonly [segment: number, percent: number];
export type Route = readonly (readonly RouteChoice[])[];
export interface WalkSegment {
  readonly startHeading: number;
  readonly endHeading: number;
  readonly spot: number;
  readonly frames: readonly WalkFrame[];
}
export const MIRRORED_FRAME = 0x8000;
export const SEGMENTS: readonly WalkSegment[];          // index = segment id 0..34; 0 is (0, 0, 0) with no frames
export const STANDING_TURNS: readonly number[];         // index = spot 0..6 (1068:0347)
export const WALKING_TURNS: readonly number[];          // index = spot 0..6 (1068:034e)
export const ROUTES: readonly (readonly (Route | null)[])[]; // ROUTES[from - 1][to - 1]; null when from = to
```

  A `Route` has six groups: group `spot - 1` lists the choices for Johnny standing on `spot`, in table order (including any choices that can never be picked). A frame's `sprite` is the raw word: bit `MIRRORED_FRAME` means mirrored; the low 15 bits are the JOHNWALK sprite index. Frames do not include the (0, 0, 0) terminator.

Where `docs/re/walk.md` (step 1) says the layout differs from this, follow `walk.md` and say so in the commit message.

- [x] **Action 1: Write the generator**

Create `scripts/re/walk-data.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 0x2e1;
const SEGMENT_TABLE = 0x2de;
const STANDING = 0x347;
const WALKING = 0x34e;
const ROUTE_TABLE = 0xa94;
const FRAMES = 0xaea;
const SEGMENTS = 34;
const SPOTS = 6;
const END_MARK = -7;
const FRAMES_PER_LINE = 4;

const bytes = readFileSync(new URL('../../re/fixtures/walk/walk-data.bin', import.meta.url));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const int8 = (at) => view.getInt8(at - BASE);
const int16 = (at) => view.getInt16(at - BASE, true);
const uint16 = (at) => view.getUint16(at - BASE, true);

const segments = [{ startHeading: 0, endHeading: 0, spot: 0, frames: [] }];
let at = FRAMES;
for (let id = 1; id <= SEGMENTS; id++) {
  const frames = [];
  while (uint16(at) !== 0 || int16(at + 2) !== 0 || int16(at + 4) !== 0) {
    frames.push([uint16(at), int16(at + 2), int16(at + 4)]);
    at += 6;
  }
  at += 6;
  const entry = SEGMENT_TABLE + 3 * id;
  segments.push({ startHeading: int8(entry), endHeading: int8(entry + 1), spot: int8(entry + 2), frames });
}
if (at !== BASE + bytes.length) throw new Error(`frame lists end at ${at.toString(16)}`);

const turns = (base) => Array.from({ length: SPOTS + 1 }, (_, spot) => int8(base + spot));

const routes = [];
for (let from = 1; from <= SPOTS; from++) {
  const row = [];
  for (let to = 1; to <= SPOTS; to++) {
    let p = uint16(ROUTE_TABLE + 12 * from + 2 * to);
    if (p === 0) {
      row.push(null);
      continue;
    }
    const groups = [];
    for (let spot = 1; spot <= SPOTS; spot++) {
      if (int16(p) !== -spot) throw new Error(`route ${from}->${to}: no marker for spot ${spot}`);
      p += 2;
      const choices = [];
      while (int16(p) >= 0) {
        choices.push([int16(p), int16(p + 2)]);
        p += 4;
      }
      groups.push(choices);
    }
    if (int16(p) !== END_MARK) throw new Error(`route ${from}->${to}: no end mark`);
    row.push(groups);
  }
  routes.push(row);
}

const hex = (n) => `0x${n.toString(16).padStart(4, '0')}`;
const list = (value) => JSON.stringify(value).replaceAll(',', ', ');
const frameLines = (frames) => {
  const lines = [];
  for (let i = 0; i < frames.length; i += FRAMES_PER_LINE) {
    lines.push(`    ${frames.slice(i, i + FRAMES_PER_LINE).map(([sprite, x, y]) => `[${hex(sprite)}, ${x}, ${y}]`).join(', ')},`);
  }
  return lines;
};

const out = [
  '// Generated by scripts/re/walk-data.mjs from SCRANTIC.SCR 1068:02e1..165f. Do not edit.',
  '',
  'export type WalkFrame = readonly [sprite: number, x: number, y: number];',
  'export type RouteChoice = readonly [segment: number, percent: number];',
  'export type Route = readonly (readonly RouteChoice[])[];',
  '',
  'export interface WalkSegment {',
  '  readonly startHeading: number;',
  '  readonly endHeading: number;',
  '  readonly spot: number;',
  '  readonly frames: readonly WalkFrame[];',
  '}',
  '',
  'export const MIRRORED_FRAME = 0x8000;',
  '',
  'export const SEGMENTS: readonly WalkSegment[] = [',
];
for (const { startHeading, endHeading, spot, frames } of segments) {
  if (frames.length === 0) {
    out.push(`  { startHeading: ${startHeading}, endHeading: ${endHeading}, spot: ${spot}, frames: [] },`);
    continue;
  }
  out.push(`  { startHeading: ${startHeading}, endHeading: ${endHeading}, spot: ${spot}, frames: [`, ...frameLines(frames), '  ] },');
}
out.push(
  '];',
  '',
  `export const STANDING_TURNS: readonly number[] = ${list(turns(STANDING))};`,
  `export const WALKING_TURNS: readonly number[] = ${list(turns(WALKING))};`,
  '',
  'export const ROUTES: readonly (readonly (Route | null)[])[] = [',
  ...routes.flatMap((row) => ['  [', ...row.map((route) => `    ${route ? list(route) : 'null'},`), '  ],']),
  '];',
);
writeFileSync(new URL('../../src/walk/walk-tables.ts', import.meta.url), out.join('\n') + '\n');
```

The header comment stays: a reader would otherwise edit the generated file by hand.

- [x] **Action 2: Generate the tables**

Run: `node scripts/re/walk-data.mjs`
Expected: exits 0 and writes `src/walk/walk-tables.ts`.

Run: `fnm use`, then `pnpm exec tsc --noEmit`
Expected: no errors.

Open `src/walk/walk-tables.ts` and check by eye: `SEGMENTS[1]` is `{ startHeading: 5, endHeading: 5, spot: 5, ... }` with 16 frames, the first `[0x8013, 306, 238]`; `STANDING_TURNS` is `[0, 6, 10, 17, 22, 28, 34]`; `ROUTES[0][0]` is `null`.

- [x] **Action 3: Write the byte-for-byte data test**

Create `src/walk/walk-tables.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeBmp } from '../decode/bmp.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureBytes } from '../testing/corpus.js';
import { ROUTES, SEGMENTS, STANDING_TURNS, WALKING_TURNS } from './walk-tables.js';

const BASE = 0x2e1;
const END = 0x1660;
const SEGMENT_TABLE = 0x2de;
const STANDING = 0x347;
const WALKING = 0x34e;
const NAME = 0x355;
const ROUTE_LISTS = 0x362;
const ROUTE_TABLE = 0xa94;
const FRAMES = 0xaea;
const END_MARK = -7;

function encodeWalkTables(): Uint8Array {
  const bytes = new Uint8Array(END - BASE);
  const view = new DataView(bytes.buffer);
  const at = (address: number) => address - BASE;
  SEGMENTS.forEach((segment, id) => {
    if (id === 0) return;
    const entry = at(SEGMENT_TABLE + 3 * id);
    view.setInt8(entry, segment.startHeading);
    view.setInt8(entry + 1, segment.endHeading);
    view.setInt8(entry + 2, segment.spot);
  });
  STANDING_TURNS.forEach((id, spot) => view.setInt8(at(STANDING + spot), id));
  WALKING_TURNS.forEach((id, spot) => view.setInt8(at(WALKING + spot), id));
  new TextEncoder().encodeInto('JOHNWALK.BMP\0', bytes.subarray(at(NAME)));
  let list = ROUTE_LISTS;
  ROUTES.forEach((row, from) => row.forEach((route, to) => {
    if (!route) return;
    view.setUint16(at(ROUTE_TABLE + 12 * (from + 1) + 2 * (to + 1)), list, true);
    route.forEach((choices, spot) => {
      view.setInt16(at(list), -(spot + 1), true);
      list += 2;
      for (const [segment, percent] of choices) {
        view.setInt16(at(list), segment, true);
        view.setInt16(at(list + 2), percent, true);
        list += 4;
      }
    });
    view.setInt16(at(list), END_MARK, true);
    list += 2;
  }));
  expect(list).toBe(ROUTE_TABLE + 12 + 2);
  let frame = FRAMES;
  for (const segment of SEGMENTS.slice(1)) {
    for (const [sprite, x, y] of segment.frames) {
      view.setUint16(at(frame), sprite, true);
      view.setInt16(at(frame + 2), x, true);
      view.setInt16(at(frame + 4), y, true);
      frame += 6;
    }
    frame += 6;
  }
  expect(frame).toBe(END);
  return bytes;
}

describe.skipIf(!hasFixture('walk/walk-data.bin'))('walk tables', () => {
  it('equal the walk block of SCRANTIC.SCR byte for byte', () => {
    // SCRANTIC 1068:02e1 1068:0347 1068:034e 1068:0362 1068:0a94 1068:0aea
    expect(encodeWalkTables()).toEqual(readFixtureBytes('walk/walk-data.bin'));
  });
});

describe.skipIf(!hasCorpus)('walk frames on the real data', () => {
  it('only name sprites that JOHNWALK.BMP has', () => {
    // SCRANTIC 1018:0094
    const count = decodeBmp(loadArchive().byName.get('JOHNWALK.BMP')!.payload).sprites.length;
    const used = SEGMENTS.flatMap((segment) => segment.frames.map(([sprite]) => sprite & 0x7fff));
    expect(Math.max(...used)).toBeLessThan(count);
  });
});
```

The route lists end exactly where the first used table word (1, 1) lies (`0x0a94 + 12 + 2 = 0x0aa2`). The table's row 0 and column 0 are never read (`1018:03ac` returns 0 for spot 0), and their addresses fall inside the last route list, which is why the formula's base `0x0a94` is below the lists' end.

Run: `pnpm test src/walk/walk-tables.data.test.ts`
Expected: 2 passed (both describe blocks run when `public/data/` and the fixture exist).

- [x] **Action 4: Write the table rule tests**

Create `src/walk/walk-tables.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ROUTES, SEGMENTS, STANDING_TURNS, WALKING_TURNS } from './walk-tables.js';

const SPOTS = 6;
const HEADINGS = 8;
const FULL = 100;
const turnSets = new Set([...STANDING_TURNS, ...WALKING_TURNS].filter((id) => id !== 0));

describe('walk tables', () => {
  it('has a route for every pair of different spots and none for a spot to itself', () => {
    // SCRANTIC 1018:03ac 1068:0a94
    for (let from = 1; from <= SPOTS; from++) {
      for (let to = 1; to <= SPOTS; to++) expect(ROUTES[from - 1]![to - 1] === null, `${from}->${to}`).toBe(from === to);
    }
  });

  it('gives the target spot of a route the single choice (0, 0), and every other spot choices that reach 100 percent', () => {
    // SCRANTIC 1018:0094
    ROUTES.forEach((row, from) => row.forEach((route, to) => {
      if (!route) return;
      expect(route).toHaveLength(SPOTS);
      route.forEach((choices, spot) => {
        if (spot === to) expect(choices, `${from + 1}->${to + 1}`).toEqual([[0, 0]]);
        else expect(choices.reduce((sum, [, percent]) => sum + percent, 0), `${from + 1}->${to + 1} at ${spot + 1}`).toBeGreaterThanOrEqual(FULL);
      });
    }));
  });

  it('routes only through walking segments, never through a turn set', () => {
    // SCRANTIC 1018:0094 1018:03ea
    ROUTES.forEach((row, from) => row.forEach((route, to) => route?.forEach((choices, spot) => {
      if (spot === to) return;
      for (const [segment] of choices) {
        expect(turnSets.has(segment), `${from + 1}->${to + 1} at ${spot + 1}: ${segment}`).toBe(false);
        expect(SEGMENTS[segment]!.frames.length).toBeGreaterThan(0);
      }
    })));
  });

  it('has one frame per heading in every turn set, and no headings or spot of its own', () => {
    // SCRANTIC 1068:0347 1068:034e
    for (const id of turnSets) {
      expect(SEGMENTS[id]).toMatchObject({ startHeading: 0, endHeading: 0, spot: 0 });
      expect(SEGMENTS[id]!.frames).toHaveLength(HEADINGS);
    }
  });

  it('numbers 34 segments after the empty segment 0', () => {
    // SCRANTIC 1018:03ea
    expect(SEGMENTS).toHaveLength(35);
    expect(SEGMENTS[0]).toEqual({ startHeading: 0, endHeading: 0, spot: 0, frames: [] });
  });
});
```

Run: `pnpm test src/walk/walk-tables.test.ts`
Expected: 5 passed. A failure is a data fact: if `docs/re/walk.md` already says so (step 1, Action 6), the test is wrong: fix the test to state what `walk.md` says. If `walk.md` does not say so, add the fact to `walk.md` (`Tables`) and fix the test the same way. In both cases say so in the commit message.

- [x] **Action 5: Run everything and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

```bash
git add scripts/re/walk-data.mjs src/walk/walk-tables.ts src/walk/walk-tables.test.ts src/walk/walk-tables.data.test.ts
git commit -m "feat(walk): generate the original walk tables and pin them byte for byte"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
