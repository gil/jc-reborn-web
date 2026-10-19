# Step 3: Story Port (Table, Random, Calendar, Sequences)

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-story-findings.md`, `step-002-original-story-trace.md`

**Files:**

- Create: `src/story/scene-table.ts`, `src/story/random.ts`, `src/story/calendar.ts`, `src/story/sequence.ts`
- Test: `src/story/random.test.ts`, `src/story/calendar.test.ts`, `src/story/sequence.test.ts`, `src/story/scene-table.data.test.ts`, `src/story/random.data.test.ts`, `src/story/sequence.data.test.ts`
- Modify: `docs/re/story.md` (checklist rows), `docs/re/open-questions.md` (OQ-6 resolved, OQ-34 added)

**Interfaces:**

- Consumes: `docs/re/story.md` (`Random`, `Scene table`, `Time slots and holidays`, `Day counters`, `Sequence building`); fixtures `re/fixtures/story/sequences.tsv`, `random.tsv`, `scene-table.bin`, `random-table.bin` (formats in the overview's `Trace formats`); `hasFixture(path)`, `readFixtureRows(path)`, `readFixtureBytes(path)` from `src/testing/corpus.ts`.
- Produces (step 6 and 7 rely on these exact names):
  - `src/story/scene-table.ts`: `interface SceneEntry { index; id; weight; spotStart; hdgStart; spotEnd; hdgEnd; length; fromSlot; toSlot; day; flags; place; ads; tag }` (all `number`); `SCENES: readonly SceneEntry[]` (80); `ADS_FILES: ReadonlyMap<number, string>`; `IDLE_ENTRY = -1`; flag constants `SCENE_OPENS = 0x01`, `SCENE_MIDDLE = 0x02`, `SCENE_CLOSES = 0x04`, `SCENE_REPEATS = 0x08`, `SCENE_NO_HOLIDAY = 0x10`, `SCENE_NO_LOW_TIDE = 0x200`, `SCENE_TTM_LEFT = 0x400`, `SCENE_NIGHT = 0x800`, `SCENE_STILL = 0x1000`, `SCENE_NO_ISLAND = 0x2000`, `SCENE_NO_RAFT = 0x4000`; `encodeScenes(): Uint8Array`.
  - `src/story/random.ts`: `interface RandomSource { next(): number; percent(...weights: number[]): number }`; `class StoryRandom implements RandomSource` with `next()`, `discard(count)`, `percent(...weights)`, getter `writeIndex`; `percentPick(value, weights): number`; `seedRandom(random, seconds)`; `RANDOM_START: { read: number; write: number; table: readonly number[] }`.
  - `src/story/calendar.ts`: `interface WallClock { year; month; day; hour; minute }`; `interface DayCounters { numDays; introduction; year; month; day }`; `HOLIDAY_NONE = 0`, `HOLIDAY_HALLOWEEN = 1`, `HOLIDAY_CHRISTMAS = 2`, `HOLIDAY_NEW_YEAR = 3`, `HOLIDAY_ST_PATRICK = 4`; `halfHourSlot(hhmm)`, `timeSlot(clock, startTime)`, `holidayOf(clock)`, `wallClockOf(date: Date): WallClock` (local time).
  - `src/story/sequence.ts`: `NO_PLACE = 0xffff`, `NO_TIDE = 0xffff`, `MODE_ISLAND = 0`, `MODE_NIGHT = 1`, `MODE_NO_ISLAND = 2`, `KIND_OPENING = 1`, `KIND_MIDDLE = 2`, `KIND_CLOSING = 4`, `KIND_DAY = 0x80`; `interface IslandFlags { place: number; lowTide: number; mode: number; still: boolean; noRaft: boolean; holidayShown: boolean }`; `interface StoryMemory { lastClosing: SceneEntry | null; lastExtra: SceneEntry | null; dayScene: SceneEntry | null; dayScenePicked: boolean; newSequence: boolean }`; `interface Sequence { queue: SceneEntry[]; position: number; slot: number; holiday: number; spot: number; heading: number }`; `interface StoryWorld { random: RandomSource; days: DayCounters; memory: StoryMemory; island: IslandFlags; sequence: Sequence; startTime: number }`; `makeStoryWorld(random): StoryWorld`; `resetIslandFlags(flags)`, `applySceneFlags(flags, entry)`, `fitsIsland(place, entryPlace): boolean`, `advanceDays(world, clock)`, `pickScene(world, kind, slot, budget): SceneEntry | null`, `buildQueue(world, slot): SceneEntry[]`, `newSequence(world, clock)`.

The code blocks below follow the overview's first reading. Where `docs/re/story.md` says otherwise, follow `story.md` and fix the test too; the data tests at the end are the judge.

## Part A: Scene table

- [x] **Action 1: Write the table data test**

Create `src/story/scene-table.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureBytes } from '../testing/corpus.js';
import { encodeScenes, SCENES } from './scene-table.js';

describe.skipIf(!hasFixture('story/scene-table.bin'))('scene table', () => {
  it('equals the table in SCRANTIC.SCR byte for byte', () => {
    // SCRANTIC 1068:1756
    expect(encodeScenes()).toEqual(readFixtureBytes('story/scene-table.bin'));
  });

  it('numbers the entries by position', () => {
    expect(SCENES.map((entry) => entry.index)).toEqual(SCENES.map((_, index) => index));
  });
});
```

- [x] **Action 2: Run it to make sure it fails**

Run: `pnpm exec vitest run src/story/scene-table.data.test.ts`
Expected: FAIL, cannot resolve `./scene-table.js`.

- [x] **Action 3: Write `src/story/scene-table.ts`**

```ts
export interface SceneEntry {
  index: number;
  id: number;
  weight: number;
  spotStart: number;
  hdgStart: number;
  spotEnd: number;
  hdgEnd: number;
  length: number;
  fromSlot: number;
  toSlot: number;
  day: number;
  flags: number;
  place: number;
  ads: number;
  tag: number;
}

export const SCENE_OPENS = 0x0001;
export const SCENE_MIDDLE = 0x0002;
export const SCENE_CLOSES = 0x0004;
export const SCENE_REPEATS = 0x0008;
export const SCENE_NO_HOLIDAY = 0x0010;
export const SCENE_NO_LOW_TIDE = 0x0200;
export const SCENE_TTM_LEFT = 0x0400;
export const SCENE_NIGHT = 0x0800;
export const SCENE_STILL = 0x1000;
export const SCENE_NO_ISLAND = 0x2000;
export const SCENE_NO_RAFT = 0x4000;

export const IDLE_ENTRY = -1;
const ENTRY_BYTES = 17;

export const ADS_FILES: ReadonlyMap<number, string> = new Map([
  [101, 'ACTIVITY.ADS'],
  [102, 'BUILDING.ADS'],
  [104, 'FISHING.ADS'],
  [105, 'JOHNNY.ADS'],
  [106, 'MARY.ADS'],
  [107, 'MISCGAG.ADS'],
  [108, 'STAND.ADS'],
  [109, 'SUZY.ADS'],
  [110, 'VISITOR.ADS'],
  [111, 'WALKSTUF.ADS'],
]);

const ROWS: readonly (readonly number[])[] = [
  // id, weight, spotStart, hdgStart, spotEnd, hdgEnd, length, fromSlot, toSlot, day, flags, place, ads, tag
  [200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x0000, 0x0000, 0, 0],
  [201, 30, 0, 0, 4, 7, 15, 0, 8, 0, 0x0201, 0x0000, 101, 8],
  [202, 10, 6, 2, 1, 2, 25, 0, 16, 0, 0x0003, 0x0000, 102, 1],
  [202, 10, 5, 6, 4, 7, 15, 0, 12, 0, 0x0203, 0x0000, 111, 2],
  [202, 10, 6, 2, 0, 0, 60, 0, 16, 0, 0x1204, 0x0008, 102, 2],
  [203, 10, 4, 0, 4, 2, 15, 0, 16, 0, 0x0003, 0x0000, 110, 4],
  [203, 10, 4, 0, 4, 1, 10, 0, 16, 0, 0x0003, 0x0000, 110, 6],
  [203, 10, 4, 0, 4, 1, 10, 0, 16, 0, 0x0003, 0x0000, 110, 7],
  [203, 10, 5, 1, 0, 0, 60, 0, 16, 0, 0x0404, 0x0001, 110, 5],
  [204, 10, 5, 6, 0, 0, 45, 0, 16, 1, 0x0204, 0x0008, 106, 2],
  [204, 10, 6, 1, 0, 0, 60, 8, 16, 4, 0x0205, 0x0008, 106, 3],
  [204, 10, 5, 1, 0, 0, 30, 12, 16, 5, 0x1804, 0x0008, 106, 1],
  [204, 10, 5, 6, 0, 0, 35, 0, 16, 7, 0x0204, 0x0008, 106, 4],
  [204, 10, 0, 0, 0, 0, 45, 0, 16, 8, 0x4605, 0x0003, 106, 5],
  [205, 10, 5, 7, 5, 7, 10, 0, 16, 0, 0x0003, 0x0000, 101, 4],
  [205, 10, 5, 7, 0, 0, 10, 0, 16, 0, 0x0204, 0x0000, 101, 1],
  [206, 10, 4, 2, 4, 6, 25, 0, 12, 0, 0x0003, 0x0000, 102, 5],
  [206, 10, 4, 2, 4, 6, 10, 0, 12, 0, 0x0003, 0x0000, 102, 7],
  [206, 10, 4, 2, 4, 6, 25, 12, 16, 0, 0x0003, 0x0000, 102, 9],
  [206, 10, 4, 2, 4, 6, 10, 12, 16, 0, 0x0003, 0x0000, 102, 8],
  [207, 10, 4, 2, 4, 6, 25, 0, 16, 0, 0x0003, 0x0000, 104, 1],
  [207, 10, 4, 2, 4, 6, 25, 0, 16, 0, 0x0003, 0x0000, 104, 2],
  [207, 10, 5, 6, 5, 2, 25, 0, 16, 0, 0x0403, 0x0000, 104, 7],
  [207, 10, 5, 6, 5, 2, 20, 0, 16, 0, 0x0403, 0x0000, 104, 8],
  [207, 10, 4, 2, 0, 0, 15, 0, 16, 0, 0x0004, 0x0010, 104, 3],
  [207, 10, 4, 2, 0, 0, 15, 0, 16, 0, 0x0004, 0x0010, 104, 6],
  [207, 10, 5, 6, 0, 0, 12, 0, 16, 0, 0x0404, 0x0020, 104, 4],
  [207, 10, 5, 6, 0, 0, 10, 0, 16, 0, 0x0204, 0x0005, 104, 5],
  [208, 15, 5, 1, 6, 5, 30, 0, 12, 0, 0x0203, 0x0000, 105, 4],
  [208, 15, 5, 1, 6, 5, 30, 0, 12, 0, 0x0203, 0x0000, 105, 5],
  [208, 10, 4, 2, 5, 6, 60, 0, 16, 0, 0x0003, 0x0000, 111, 3],
  [208, 10, 4, 2, 0, 0, 20, 0, 8, 0, 0x0204, 0x0000, 107, 2],
  [208, 10, 5, 1, 0, 0, 50, 0, 16, 0, 0x0004, 0x0000, 101, 5],
  [208, 10, 4, 6, 0, 0, 15, 0, 16, 0, 0x0004, 0x0000, 107, 1],
  [209, 10, 4, 1, 6, 0, 15, 0, 16, 0, 0x0003, 0x0000, 101, 7],
  [209, 10, 4, 1, 0, 0, 25, 0, 16, 0, 0x0204, 0x0000, 101, 6],
  [209, 10, 4, 1, 0, 0, 25, 0, 16, 0, 0x0004, 0x0000, 101, 10],
  [209, 5, 0, 0, 0, 0, 30, 0, 16, 0, 0x0205, 0x000a, 101, 11],
  [209, 10, 4, 1, 0, 0, 25, 0, 16, 0, 0x0004, 0x0000, 101, 12],
  [210, 1, 1, 1, 1, 1, 15, 0, 16, 0, 0x0003, 0x0000, 108, 1],
  [210, 1, 1, 2, 1, 2, 15, 0, 16, 0, 0x0003, 0x0000, 108, 2],
  [210, 1, 1, 3, 1, 3, 15, 0, 16, 0, 0x0003, 0x0000, 108, 3],
  [210, 1, 2, 1, 2, 1, 15, 0, 16, 0, 0x0003, 0x0000, 108, 4],
  [210, 1, 2, 0, 2, 0, 15, 0, 16, 0, 0x0003, 0x0000, 108, 5],
  [210, 1, 2, 7, 2, 7, 15, 0, 16, 0, 0x0003, 0x0000, 108, 6],
  [210, 1, 3, 5, 3, 5, 15, 0, 16, 0, 0x0003, 0x0000, 108, 7],
  [210, 1, 3, 6, 3, 6, 15, 0, 16, 0, 0x0003, 0x0000, 108, 8],
  [210, 1, 4, 3, 4, 3, 15, 0, 16, 0, 0x0003, 0x0000, 108, 9],
  [210, 1, 4, 7, 4, 7, 15, 0, 16, 0, 0x0003, 0x0000, 108, 10],
  [210, 1, 5, 3, 5, 3, 15, 0, 16, 0, 0x0003, 0x0000, 108, 11],
  [210, 1, 6, 0, 6, 0, 15, 0, 16, 0, 0x0003, 0x0000, 108, 12],
  [211, 10, 1, 6, 3, 6, 60, 0, 16, 0, 0x0003, 0x0000, 102, 3],
  [211, 10, 1, 6, 0, 0, 105, 0, 12, 0, 0x1204, 0x0008, 102, 4],
  [211, 10, 1, 6, 0, 0, 105, 12, 16, 0, 0x1204, 0x0008, 102, 6],
  [212, 1, 1, 3, 1, 3, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 1, 2, 1, 2, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 1, 1, 1, 1, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 2, 1, 2, 1, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 2, 7, 2, 7, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 2, 0, 2, 0, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 3, 5, 3, 5, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 3, 6, 3, 6, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 3, 7, 3, 7, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 4, 5, 4, 5, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 5, 3, 5, 3, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 6, 1, 6, 1, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 6, 0, 6, 0, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [212, 1, 6, 7, 6, 7, 5, 0, 16, 0, 0x000b, 0x0000, -1, 1],
  [213, 10, 5, 1, 6, 5, 30, 0, 16, 2, 0x0003, 0x0000, 105, 2],
  [213, 10, 0, 0, 0, 0, 35, 0, 16, 3, 0x2005, 0x0000, 109, 1],
  [213, 10, 5, 1, 6, 5, 15, 0, 16, 6, 0x0003, 0x0000, 105, 3],
  [213, 10, 0, 0, 0, 0, 25, 12, 16, 9, 0x2005, 0x0000, 109, 2],
  [213, 10, 0, 0, 0, 0, 15, 12, 16, 10, 0x2005, 0x0000, 105, 6],
  [213, 10, 0, 0, 0, 0, 20, 12, 16, 11, 0x2005, 0x0000, 105, 1],
  [214, 10, 1, 0, 1, 0, 15, 0, 16, 0, 0x0003, 0x0000, 108, 15],
  [214, 10, 3, 0, 3, 0, 15, 0, 16, 0, 0x0003, 0x0000, 108, 16],
  [215, 10, 5, 6, 0, 0, 20, 0, 12, 0, 0x0004, 0x0010, 101, 9],
  [215, 15, 1, 0, 1, 0, 25, 0, 16, 0, 0x0003, 0x0010, 110, 1],
  [215, 10, 1, 5, 0, 0, 60, 0, 16, 0, 0x0004, 0x0010, 111, 1],
  [215, 10, 2, 5, 0, 0, 105, 0, 16, 0, 0x1214, 0x0010, 110, 3],
];

export const SCENES: readonly SceneEntry[] = ROWS.map(
  ([id, weight, spotStart, hdgStart, spotEnd, hdgEnd, length, fromSlot, toSlot, day, flags, place, ads, tag], index) => ({
    index, id: id!, weight: weight!, spotStart: spotStart!, hdgStart: hdgStart!, spotEnd: spotEnd!, hdgEnd: hdgEnd!,
    length: length!, fromSlot: fromSlot!, toSlot: toSlot!, day: day!, flags: flags!, place: place!, ads: ads!, tag: tag!,
  }),
);

export function encodeScenes(): Uint8Array {
  const bytes = new Uint8Array(SCENES.length * ENTRY_BYTES + 2);
  const view = new DataView(bytes.buffer);
  SCENES.forEach((entry, i) => {
    const at = i * ENTRY_BYTES;
    view.setInt16(at, entry.id, true);
    [entry.weight, entry.spotStart, entry.hdgStart, entry.spotEnd, entry.hdgEnd, entry.length, entry.fromSlot, entry.toSlot, entry.day]
      .forEach((value, k) => view.setInt8(at + 2 + k, value));
    view.setUint16(at + 0x0b, entry.flags, true);
    view.setUint16(at + 0x0d, entry.place, true);
    view.setInt8(at + 0x0f, entry.ads);
    view.setInt8(at + 0x10, entry.tag);
  });
  return bytes;
}
```

These rows were generated from `SCRANTIC.SCR` during planning. If the data test disagrees, regenerate them from `re/fixtures/story/scene-table.bin` with a scratch script, never by hand.

- [x] **Action 4: Run the test**

Run: `pnpm exec vitest run src/story/scene-table.data.test.ts`
Expected: PASS (2 tests).

- [x] **Action 5: Commit**

```bash
git add src/story/scene-table.ts src/story/scene-table.data.test.ts
git commit -m "feat(story): the original scene table"
```

## Part B: Random generator

- [x] **Action 6: Write the failing tests**

Create `src/story/random.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { percentPick, RANDOM_START, seedRandom, StoryRandom } from './random.js';

describe('story random generator', () => {
  it('adds the read slot into the write slot and returns it', () => {
    // SCRANTIC 1018:1e60
    const { read, write, table } = RANDOM_START;
    expect(new StoryRandom().next()).toBe((table[write]! + table[read]!) & 0xffff);
  });

  it('moves both indices by one and wraps at 56', () => {
    // SCRANTIC 1018:1e60
    const random = new StoryRandom();
    random.next();
    expect(random.writeIndex).toBe(0);
    random.discard(55);
    expect(random.writeIndex).toBe(55);
  });

  it('seeds by dropping time & 0xffff numbers', () => {
    // SCRANTIC 1018:1ed4 1018:1eb6 1000:082c
    const seeded = new StoryRandom();
    seedRandom(seeded, 0x10003);
    const manual = new StoryRandom();
    manual.discard(3);
    expect(seeded.next()).toBe(manual.next());
  });
});

describe('percent pick', () => {
  it('returns the first weight whose share exceeds the remaining value', () => {
    // SCRANTIC 1018:1ef5
    expect(percentPick(0, [50])).toBe(1);
    expect(percentPick(50 * 0x28f - 1, [50])).toBe(1);
    expect(percentPick(50 * 0x28f, [50])).toBe(0);
    expect(percentPick(5 * 0x28f, [5, 10, 15])).toBe(2);
    expect(percentPick(15 * 0x28f, [5, 10, 15])).toBe(3);
    expect(percentPick(30 * 0x28f, [5, 10, 15])).toBe(0);
  });
});
```

Create `src/story/random.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureBytes, readFixtureRows } from '../testing/corpus.js';
import { RANDOM_START, StoryRandom } from './random.js';

describe.skipIf(!hasFixture('story/random.tsv'))('random generator matches the original SCRANTIC.SCR', () => {
  it('starts from the same table', () => {
    // SCRANTIC 1068:1ce4
    const bytes = readFixtureBytes('story/random-table.bin');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const table = Array.from({ length: 56 }, (_, i) => view.getUint16(4 + 2 * i, true));
    expect({ read: view.getUint16(0, true), write: view.getUint16(2, true), table }).toEqual({ ...RANDOM_START, table: [...RANDOM_START.table] });
  });

  it('draws the same numbers and percent picks', () => {
    // SCRANTIC 1018:1e60 1018:1eb6 1018:1ef5
    const generators = new Map<string, StoryRandom>();
    const wrong: string[] = [];
    for (const [kind, seed, call, value] of readFixtureRows('story/random.tsv')) {
      const key = kind === 'next' ? `next ${seed}` : 'percent';
      if (!generators.has(key)) {
        const random = new StoryRandom();
        random.discard(Number(seed));
        generators.set(key, random);
      }
      const random = generators.get(key)!;
      const ours = kind === 'next' ? random.next() : random.percent(...kind!.slice('percent:'.length).split(',').map(Number));
      if (ours !== Number(value)) wrong.push(`${kind} ${seed} ${call}: ours ${ours}, original ${value}`);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });
});
```

- [x] **Action 7: Run them to make sure they fail**

Run: `pnpm exec vitest run src/story/random.test.ts src/story/random.data.test.ts`
Expected: FAIL, cannot resolve `./random.js`.

- [x] **Action 8: Write `src/story/random.ts`**

```ts
const PERCENT_SCALE = 0x28f;

export const RANDOM_START = {
  read: 24,
  write: 55,
  table: [
    0xdd23, 0x9533, 0xf3cd, 0x4bc2, 0xf7e2, 0xa2df, 0xaa70, 0x60aa,
    0x144b, 0x8948, 0x192a, 0x6b0d, 0x9e0b, 0xfbf1, 0x8607, 0x465d,
    0xeaf4, 0x69fd, 0x6c44, 0x1b27, 0xdb71, 0xe38f, 0xabb4, 0xdc47,
    0x0fde, 0x4d8e, 0xfc7d, 0x8d38, 0x5948, 0xe36f, 0xaa22, 0x2f26,
    0x43fa, 0xb5a5, 0x20eb, 0xed85, 0xf5c3, 0x819f, 0x2d9c, 0xb26d,
    0xe92b, 0x97d5, 0x3da1, 0x89ed, 0xe3f4, 0x74b5, 0x002c, 0xd35f,
    0x3b08, 0x0df5, 0xf27e, 0xc270, 0x2589, 0x2e8b, 0x6352, 0xda2d,
  ] as readonly number[],
};

export interface RandomSource {
  next(): number;
  percent(...weights: number[]): number;
}

export function percentPick(value: number, weights: readonly number[]): number {
  for (let i = 0; i < weights.length; i++) {
    const share = (weights[i]! * PERCENT_SCALE) & 0xffff;
    if (share > value) return i + 1;
    value -= share;
  }
  return 0;
}

export class StoryRandom implements RandomSource {
  private readonly table = [...RANDOM_START.table];
  private read = RANDOM_START.read;
  private write = RANDOM_START.write;

  get writeIndex(): number {
    return this.write;
  }

  next(): number {
    const at = this.write;
    this.table[at] = (this.table[at]! + this.table[this.read]!) & 0xffff;
    this.write = (this.write + 1) % this.table.length;
    this.read = (this.read + 1) % this.table.length;
    return this.table[at]!;
  }

  discard(count: number): void {
    for (let i = 0; i < count; i++) this.next();
  }

  percent(...weights: number[]): number {
    return percentPick(this.next(), weights);
  }
}

export function seedRandom(random: StoryRandom, seconds: number): void {
  random.discard(seconds & 0xffff);
}
```

- [x] **Action 9: Run the tests**

Run: `pnpm exec vitest run src/story/random.test.ts src/story/random.data.test.ts`
Expected: PASS.

- [x] **Action 10: Commit**

```bash
git add src/story/random.ts src/story/random.test.ts src/story/random.data.test.ts
git commit -m "feat(story): port the original random generator"
```

## Part C: Calendar

- [x] **Action 11: Write the failing tests**

Create `src/story/calendar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  halfHourSlot, holidayOf, timeSlot,
  HOLIDAY_CHRISTMAS, HOLIDAY_HALLOWEEN, HOLIDAY_NEW_YEAR, HOLIDAY_NONE, HOLIDAY_ST_PATRICK,
  type WallClock,
} from './calendar.js';

const at = (month: number, day: number, hour = 12, minute = 0): WallClock => ({ year: 1992, month, day, hour, minute });

describe('time slots', () => {
  it('maps HHMM to half-hour slots of an 8-hour cycle', () => {
    // SCRANTIC 1018:0c21
    expect(halfHourSlot(900)).toBe(0);
    expect(halfHourSlot(930)).toBe(1);
    expect(halfHourSlot(1500)).toBe(12);
    expect(halfHourSlot(1700)).toBe(0);
    expect(halfHourSlot(0)).toBe(14);
  });

  it('counts slots from the start time and drops minutes inside a half hour', () => {
    // SCRANTIC 1018:0540
    expect(timeSlot(at(6, 1, 9, 0), 900)).toBe(0);
    expect(timeSlot(at(6, 1, 9, 29), 900)).toBe(0);
    expect(timeSlot(at(6, 1, 9, 30), 900)).toBe(1);
    expect(timeSlot(at(6, 1, 15, 0), 900)).toBe(12);
    expect(timeSlot(at(6, 1, 16, 59), 900)).toBe(15);
    expect(timeSlot(at(6, 1, 17, 0), 900)).toBe(0);
    expect(timeSlot(at(6, 1, 8, 0), 900)).toBe(14);
  });
});

describe('holidays', () => {
  it('knows the four holiday date ranges', () => {
    // SCRANTIC 1018:0540
    expect(holidayOf(at(10, 28))).toBe(HOLIDAY_NONE);
    expect(holidayOf(at(10, 29))).toBe(HOLIDAY_HALLOWEEN);
    expect(holidayOf(at(10, 31))).toBe(HOLIDAY_HALLOWEEN);
    expect(holidayOf(at(12, 22))).toBe(HOLIDAY_NONE);
    expect(holidayOf(at(12, 23))).toBe(HOLIDAY_CHRISTMAS);
    expect(holidayOf(at(12, 25))).toBe(HOLIDAY_CHRISTMAS);
    expect(holidayOf(at(12, 26))).toBe(HOLIDAY_NONE);
    expect(holidayOf(at(12, 29))).toBe(HOLIDAY_NEW_YEAR);
    expect(holidayOf(at(1, 1))).toBe(HOLIDAY_NEW_YEAR);
    expect(holidayOf(at(1, 2))).toBe(HOLIDAY_NONE);
    expect(holidayOf(at(3, 14))).toBe(HOLIDAY_NONE);
    expect(holidayOf(at(3, 15))).toBe(HOLIDAY_ST_PATRICK);
    expect(holidayOf(at(3, 17))).toBe(HOLIDAY_ST_PATRICK);
    expect(holidayOf(at(3, 18))).toBe(HOLIDAY_NONE);
  });
});
```

- [x] **Action 12: Run them to make sure they fail**

Run: `pnpm exec vitest run src/story/calendar.test.ts`
Expected: FAIL, cannot resolve `./calendar.js`.

- [x] **Action 13: Write `src/story/calendar.ts`**

```ts
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface DayCounters {
  numDays: number;
  introduction: number;
  year: number;
  month: number;
  day: number;
}

export const HOLIDAY_NONE = 0;
export const HOLIDAY_HALLOWEEN = 1;
export const HOLIDAY_CHRISTMAS = 2;
export const HOLIDAY_NEW_YEAR = 3;
export const HOLIDAY_ST_PATRICK = 4;

const SLOTS = 16;

export function halfHourSlot(hhmm: number): number {
  return (Math.trunc(hhmm / 50) + Math.trunc((hhmm % 100) / 30) + 14) % SLOTS;
}

export function timeSlot(clock: WallClock, startTime: number): number {
  const now = clock.hour * 100 + (clock.minute >= 30 ? 30 : 0);
  return (halfHourSlot(now) - halfHourSlot(startTime) + SLOTS) % SLOTS;
}

export function holidayOf({ month, day }: WallClock): number {
  if (month === 10 && day > 28) return HOLIDAY_HALLOWEEN;
  if (month === 12 && day > 22 && day < 26) return HOLIDAY_CHRISTMAS;
  if (month === 12 && day > 28) return HOLIDAY_NEW_YEAR;
  if (month === 1 && day === 1) return HOLIDAY_NEW_YEAR;
  if (month === 3 && day > 14 && day < 18) return HOLIDAY_ST_PATRICK;
  return HOLIDAY_NONE;
}

export function wallClockOf(date: Date): WallClock {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
}
```

`halfHourSlot` of a negative or odd StartTime from a hand-edited setting follows C's truncating division and remainder, which `Math.trunc` and `%` reproduce.

- [x] **Action 14: Run the tests**

Run: `pnpm exec vitest run src/story/calendar.test.ts`
Expected: PASS.

- [x] **Action 15: Commit**

```bash
git add src/story/calendar.ts src/story/calendar.test.ts
git commit -m "feat(story): time slots and holidays from the original"
```

## Part D: Sequences

- [x] **Action 16: Write the failing unit tests**

Create `src/story/sequence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { WallClock } from './calendar.js';
import { StoryRandom } from './random.js';
import { SCENE_CLOSES, SCENE_OPENS, SCENES } from './scene-table.js';
import {
  advanceDays, applySceneFlags, buildQueue, fitsIsland, makeStoryWorld, newSequence, pickScene,
  KIND_CLOSING, MODE_NIGHT, MODE_NO_ISLAND, NO_PLACE, NO_TIDE,
} from './sequence.js';

const clock = (day: number): WallClock => ({ year: 1992, month: 6, day, hour: 10, minute: 0 });

describe('island flags', () => {
  it('turns entry flags and place bits into island settings', () => {
    // SCRANTIC 1010:1c41
    const world = makeStoryWorld(new StoryRandom());
    expect(world.island).toEqual({ place: NO_PLACE, lowTide: NO_TIDE, mode: 0, still: false, noRaft: false, holidayShown: true });
    applySceneFlags(world.island, SCENES[13]!);
    expect(world.island).toMatchObject({ lowTide: 0, noRaft: true, place: 0x04 | 0x08 });
    applySceneFlags(world.island, SCENES[11]!);
    expect(world.island.mode).toBe(MODE_NIGHT);
    expect(world.island.still).toBe(true);
    applySceneFlags(world.island, SCENES[69]!);
    expect(world.island.mode).toBe(MODE_NO_ISLAND);
  });

  it('accepts any place while none is chosen and rejects clashing ones', () => {
    // SCRANTIC 1018:0eb5
    expect(fitsIsland(NO_PLACE, 0x20)).toBe(true);
    expect(fitsIsland(0x02, 0x20)).toBe(false);
    expect(fitsIsland(0x01, 0x10)).toBe(false);
    expect(fitsIsland(0, 0x20)).toBe(true);
  });
});

describe('day counters', () => {
  it('starts a fresh install on day one', () => {
    // SCRANTIC 1018:0b87
    const world = makeStoryWorld(new StoryRandom());
    advanceDays(world, clock(1));
    expect(world.days).toEqual({ numDays: 1, introduction: 1, year: 1992, month: 6, day: 1 });
  });

  it('moves Introduction on after a day scene was picked, and NumDays on the next date', () => {
    // SCRANTIC 1018:0b87
    const world = makeStoryWorld(new StoryRandom());
    advanceDays(world, clock(1));
    world.memory.newSequence = true;
    world.memory.dayScenePicked = true;
    advanceDays(world, clock(1));
    expect(world.days).toMatchObject({ numDays: 1, introduction: 2 });
    expect(world.memory).toMatchObject({ newSequence: false, dayScenePicked: false });
    advanceDays(world, clock(2));
    expect(world.days).toMatchObject({ numDays: 2, introduction: 2, day: 2 });
  });

  it('starts over after day 11', () => {
    // SCRANTIC 1018:0b87
    const world = makeStoryWorld(new StoryRandom());
    world.days = { numDays: 11, introduction: 12, year: 1992, month: 6, day: 1 };
    advanceDays(world, clock(2));
    expect(world.days).toMatchObject({ numDays: 1, introduction: 1 });
  });
});

describe('scene picks and queues', () => {
  it('picks only entries of the kind, slot, and budget', () => {
    // SCRANTIC 1018:0d50
    const world = makeStoryWorld(new StoryRandom());
    for (let i = 0; i < 200; i++) {
      const entry = pickScene(world, KIND_CLOSING, 13, 0)!;
      expect(entry.flags & SCENE_CLOSES).not.toBe(0);
      expect(entry.day).toBe(0);
      expect(entry.fromSlot <= 13 && 13 < entry.toSlot).toBe(true);
    }
  });

  it('ends every queue with its closing scene and makes a whole-sequence scene the only entry', () => {
    // SCRANTIC 1018:089b
    for (let seed = 0; seed < 100; seed++) {
      const random = new StoryRandom();
      random.discard(seed * 37);
      const world = makeStoryWorld(random);
      advanceDays(world, clock(1));
      const queue = buildQueue(world, seed % 16);
      const closing = queue[queue.length - 1]!;
      expect(closing.flags & SCENE_CLOSES).not.toBe(0);
      expect(world.memory.lastClosing).toBe(closing);
      if (closing.flags & SCENE_OPENS) expect(queue.length).toBe(1);
    }
  });

  it('puts Johnny at the first entry and empties the old queue', () => {
    // SCRANTIC 1018:0540 1018:0673
    const world = makeStoryWorld(new StoryRandom());
    world.sequence.position = 5;
    world.memory.newSequence = true;
    newSequence(world, clock(1));
    expect(world.sequence.position).toBe(0);
    expect(world.sequence.spot).toBe(world.sequence.queue[0]!.spotStart);
    expect(world.sequence.heading).toBe(world.sequence.queue[0]!.hdgStart);
  });
});
```

- [x] **Action 17: Write the failing data test**

Create `src/story/sequence.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureRows } from '../testing/corpus.js';
import type { WallClock } from './calendar.js';
import { StoryRandom } from './random.js';
import type { SceneEntry } from './scene-table.js';
import { makeStoryWorld, newSequence, type StoryWorld } from './sequence.js';

const CASES = 16;
const BUILDS = 30;
const DISCARDS = [0, 1, 55, 56, 1000, 4096, 31337, 65535];
const START_TIMES = [900, 0, 1230, 2330];
const FIRST_DATES = [[1992, 10, 29], [1992, 12, 24], [1992, 12, 31], [1993, 1, 1], [1993, 3, 16], [1992, 6, 1]] as const;

function buildClock(k: number, b: number): WallClock {
  const [year, month, day] = FIRST_DATES[k % FIRST_DATES.length]!;
  const ms = Date.UTC(year, month - 1, day, (3 * k) % 24, (7 * k) % 60) + (Math.trunc(b / 3) * 1440 + 97 * b) * 60_000;
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

const index = (entry: SceneEntry | null) => entry?.index ?? -1;
const bit = (value: boolean) => (value ? 1 : 0);

function stateRow(world: StoryWorld, random: StoryRandom): number[] {
  const { sequence, days, island, memory } = world;
  return [
    sequence.slot, sequence.holiday, days.numDays, days.introduction, days.year, days.month, days.day,
    island.place, island.lowTide, island.mode, bit(island.still), bit(island.noRaft), bit(island.holidayShown),
    sequence.spot, sequence.heading, index(memory.lastClosing), index(memory.lastExtra), index(memory.dayScene),
    bit(memory.dayScenePicked), bit(memory.newSequence), random.writeIndex,
  ];
}

function traceCase(k: number): string[] {
  const random = new StoryRandom();
  const world = makeStoryWorld(random);
  world.days = { numDays: k % 13, introduction: (5 * k) % 13, ...(k % 2 ? { year: 1992, month: 6, day: 1 } : { year: 0, month: 0, day: 0 }) };
  world.startTime = START_TIMES[k % START_TIMES.length]!;
  random.discard(DISCARDS[k % DISCARDS.length]!);
  const rows: string[] = [];
  for (let b = 0; b < BUILDS; b++) {
    world.memory.newSequence = true;
    newSequence(world, buildClock(k, b));
    rows.push([k, b, 'queue', world.sequence.queue.map((entry) => entry.index).join(' ')].join('\t'));
    rows.push([k, b, 'state', stateRow(world, random).join(' ')].join('\t'));
  }
  return rows;
}

describe.skipIf(!hasFixture('story/sequences.tsv'))('sequence builder matches the original SCRANTIC.SCR', () => {
  it('builds the same queues and state over 16 cases of 30 sequences', () => {
    // SCRANTIC 1018:0540 1018:0b87 1018:089b 1018:0d50 1018:0eb5 1010:1c41 1018:1e60 1018:1ef5
    const original = new Map<number, string[]>();
    for (const [k, b, event, values] of readFixtureRows('story/sequences.tsv')) {
      const key = Number(k);
      if (!original.has(key)) original.set(key, []);
      original.get(key)!.push([k, b, event, values ?? ''].join('\t'));
    }
    expect([...original.keys()]).toEqual(Array.from({ length: CASES }, (_, k) => k));
    const wrong: string[] = [];
    for (const [k, rows] of original) {
      const ours = traceCase(k);
      const at = ours.findIndex((row, i) => row !== rows[i]);
      if (at >= 0) wrong.push(`case ${k} row ${at}: ours ${ours[at]}; original ${rows[at] ?? '(end)'}`);
      else if (ours.length !== rows.length) wrong.push(`case ${k}: ours ${ours.length} rows, original ${rows.length}`);
    }
    expect(wrong).toEqual([]);
  });
});
```

- [x] **Action 18: Run them to make sure they fail**

Run: `pnpm exec vitest run src/story/sequence.test.ts src/story/sequence.data.test.ts`
Expected: FAIL, cannot resolve `./sequence.js`.

- [x] **Action 19: Write `src/story/sequence.ts`**

```ts
import { holidayOf, timeSlot, type DayCounters, type WallClock } from './calendar.js';
import type { RandomSource } from './random.js';
import {
  SCENES, SCENE_CLOSES, SCENE_NIGHT, SCENE_NO_HOLIDAY, SCENE_NO_ISLAND, SCENE_NO_LOW_TIDE, SCENE_NO_RAFT,
  SCENE_OPENS, SCENE_REPEATS, SCENE_STILL, type SceneEntry,
} from './scene-table.js';

export const NO_PLACE = 0xffff;
export const NO_TIDE = 0xffff;
export const MODE_ISLAND = 0;
export const MODE_NIGHT = 1;
export const MODE_NO_ISLAND = 2;

export const KIND_OPENING = 1;
export const KIND_MIDDLE = 2;
export const KIND_CLOSING = 4;
export const KIND_DAY = 0x80;

const SEQUENCE_BUDGET = 300;
const UNLIMITED_BUDGET = 999;
const QUEUE_LIMIT = 0x12a;
const LAST_DAY = 11;
const PLACE_LEFT = 0x20;
const PLACE_LOW = 0x10;
const PLACE_BITS = 0x3f;
const PLACE_QUARTERS: readonly (readonly [number, number])[] = [[0x01, 0x04], [0x02, 0x08], [0x04, 0x10], [0x08, 0x20]];

export interface IslandFlags {
  place: number;
  lowTide: number;
  mode: number;
  still: boolean;
  noRaft: boolean;
  holidayShown: boolean;
}

export interface StoryMemory {
  lastClosing: SceneEntry | null;
  lastExtra: SceneEntry | null;
  dayScene: SceneEntry | null;
  dayScenePicked: boolean;
  newSequence: boolean;
}

export interface Sequence {
  queue: SceneEntry[];
  position: number;
  slot: number;
  holiday: number;
  spot: number;
  heading: number;
}

export interface StoryWorld {
  random: RandomSource;
  days: DayCounters;
  memory: StoryMemory;
  island: IslandFlags;
  sequence: Sequence;
  startTime: number;
}

export function makeStoryWorld(random: RandomSource): StoryWorld {
  const island = {} as IslandFlags;
  resetIslandFlags(island);
  return {
    random,
    days: { numDays: 0, introduction: 0, year: 0, month: 0, day: 0 },
    memory: { lastClosing: null, lastExtra: null, dayScene: null, dayScenePicked: false, newSequence: false },
    island,
    sequence: { queue: [], position: 0, slot: 0, holiday: 0, spot: 0, heading: 0 },
    startTime: 900,
  };
}

export function resetIslandFlags(flags: IslandFlags): void {
  Object.assign(flags, { place: NO_PLACE, lowTide: NO_TIDE, mode: MODE_ISLAND, still: false, noRaft: false, holidayShown: true });
}

export function applySceneFlags(flags: IslandFlags, entry: SceneEntry): void {
  if (entry.flags & SCENE_NO_LOW_TIDE) flags.lowTide = 0;
  if (entry.flags & SCENE_NO_RAFT) flags.noRaft = true;
  if (entry.flags & SCENE_NO_HOLIDAY) flags.holidayShown = false;
  if (entry.flags & SCENE_STILL) flags.still = true;
  if (entry.flags & SCENE_NIGHT) flags.mode = MODE_NIGHT;
  if (entry.flags & SCENE_NO_ISLAND) flags.mode = MODE_NO_ISLAND;
  if (flags.place === NO_PLACE && entry.place & PLACE_BITS) flags.place = 0;
  if (entry.place & PLACE_LEFT) flags.place = 1;
  else if (entry.place & PLACE_LOW) flags.place = 2;
  for (const [from, to] of PLACE_QUARTERS) if (entry.place & from) flags.place |= to;
}

export function fitsIsland(place: number, entryPlace: number): boolean {
  if (place === NO_PLACE) return true;
  if (entryPlace & 0x20 && place & 0x2a) return false;
  if (entryPlace & 0x10 && place & 0x15) return false;
  if (entryPlace & 0x01) {
    if (!(entryPlace & 0x02) && place & 0x2a) return false;
    if (!(entryPlace & 0x04) && place & 0x30) return false;
  }
  if (entryPlace & 0x02) {
    if (!(entryPlace & 0x01) && place & 0x15) return false;
    if (!(entryPlace & 0x08) && place & 0x30) return false;
  }
  if (entryPlace & 0x04) {
    if (!(entryPlace & 0x08) && place & 0x2a) return false;
    if (!(entryPlace & 0x01) && place & 0x0c) return false;
  }
  if (entryPlace & 0x08) {
    if (!(entryPlace & 0x04) && place & 0x15) return false;
    if (!(entryPlace & 0x02) && place & 0x0c) return false;
  }
  return true;
}

export function advanceDays(world: StoryWorld, clock: WallClock): void {
  const { days, memory } = world;
  if (days.year !== clock.year || days.month !== clock.month || days.day !== clock.day) {
    if (days.numDays < days.introduction) days.numDays++;
    if (days.numDays > LAST_DAY || days.numDays < 2) {
      days.introduction = 1;
      days.numDays = 1;
    }
    days.year = clock.year;
    days.month = clock.month;
    days.day = clock.day;
  }
  if (memory.newSequence && memory.dayScenePicked && days.introduction <= days.numDays) days.introduction++;
  memory.dayScenePicked = false;
  memory.newSequence = false;
}

export function pickScene(world: StoryWorld, kind: number, slot: number, budget: number): SceneEntry | null {
  const { random, days, island } = world;
  if (kind === KIND_CLOSING) {
    budget = UNLIMITED_BUDGET;
  } else if (kind === KIND_DAY) {
    if (random.next() % 10 !== 0) return null;
    days.introduction = days.numDays;
    budget = UNLIMITED_BUDGET;
  }
  const marked: SceneEntry[] = [];
  let total = 0;
  for (const entry of SCENES) {
    const matches = kind === KIND_DAY && entry.day === days.introduction
      || (entry.flags & kind) !== 0 && entry.tag !== 0 && entry.fromSlot <= slot && entry.day === 0
        && slot < entry.toSlot && Math.trunc(entry.length / 2) < budget && fitsIsland(island.place, entry.place);
    if (!matches) continue;
    marked.push(entry);
    total += entry.weight;
  }
  if (total === 0) return null;
  let left = (random.next() % total) + 1;
  for (const entry of marked) {
    left -= entry.weight;
    if (left <= 0) return entry;
  }
  return null;
}

export function buildQueue(world: StoryWorld, slot: number): SceneEntry[] {
  const { random, memory, island, days } = world;
  let closing: SceneEntry | null = null;
  let extra: SceneEntry | null = null;
  const day = pickScene(world, KIND_DAY, slot, 0);
  if (day && day !== memory.lastClosing && day !== memory.lastExtra) {
    memory.dayScene = day;
    if (day.flags & SCENE_CLOSES) closing = day;
    else extra = day;
  }
  while (!closing || closing === memory.lastClosing || (extra && closing.flags & SCENE_OPENS)) {
    closing = pickScene(world, KIND_CLOSING, slot, 0);
  }
  let budget = SEQUENCE_BUDGET - closing.length;
  applySceneFlags(island, closing);
  memory.lastClosing = closing;
  if (extra) {
    budget -= extra.length;
    applySceneFlags(island, extra);
  }
  memory.lastExtra = extra;
  if (closing.day === days.introduction || extra?.day === days.introduction) memory.dayScenePicked = true;

  const queue: SceneEntry[] = [];
  let extraLeft = extra !== null;
  if (closing.flags & SCENE_OPENS) {
    budget = 0;
  } else if (extra && extra.flags & SCENE_OPENS && random.percent(50) !== 0) {
    queue.push(extra);
    extraLeft = false;
  } else {
    const opening = pickScene(world, KIND_OPENING, slot, budget);
    if (!opening) return [];
    queue.push(opening);
    budget -= opening.length;
    applySceneFlags(island, opening);
  }
  while (budget !== 0 && queue.length < QUEUE_LIMIT) {
    if (extraLeft && random.percent(5) !== 0) {
      queue.push(extra!);
      extraLeft = false;
      continue;
    }
    const entry = pickScene(world, KIND_MIDDLE, slot, budget);
    if (!entry) break;
    let count = 1;
    if (entry.flags & SCENE_REPEATS) {
      do {
        do count = random.percent(10, 20, 30, 20, 10, 10); while (count === 0);
      } while (count > 1 && entry.length * count > budget);
    }
    for (; count !== 0 && queue.length < QUEUE_LIMIT; count--) {
      queue.push(entry);
      budget -= entry.length;
      applySceneFlags(island, entry);
    }
  }
  queue.push(closing);
  return queue;
}

export function newSequence(world: StoryWorld, clock: WallClock): void {
  const { sequence } = world;
  sequence.queue = [];
  sequence.position = 0;
  sequence.slot = timeSlot(clock, world.startTime);
  sequence.holiday = holidayOf(clock);
  resetIslandFlags(world.island);
  advanceDays(world, clock);
  sequence.queue = buildQueue(world, sequence.slot);
  const first = sequence.queue[0];
  if (first) {
    sequence.spot = first.spotStart;
    sequence.heading = first.hdgStart;
  }
}
```

Two places guard where the original reads through a null entry: `buildQueue` returns an empty queue when the opening pick finds nothing (the original queues a null pointer at the head, which makes the next step start a new sequence, after reading the budget and flags from data-segment offsets 7 to 14), and `newSequence` keeps Johnny's spot when the queue is empty. Log both as OQ-34 in Action 22. If step 2 saw neither in the trace, say so in the entry.

The unit test `turns entry flags and place bits into island settings` expects `place: 0x04 | 0x08` for entry 13 (place `0x0003`, flags `0x4605`). Check that against `1010:1c41` in `story.md`; fix the test if the finding says otherwise.

- [x] **Action 20: Run the tests**

Run: `pnpm exec vitest run src/story/sequence.test.ts src/story/sequence.data.test.ts`
Expected: PASS. When the data test fails, its message names the first differing row of each case. Find which value differs (the `state` columns are listed in the overview), reread the matching function in `re/out/functions/`, and fix the port, not the fixture. Typical culprits: the order of random draws in `buildQueue`, a signed versus unsigned compare in `pickScene`, the `advanceDays` order.

- [x] **Action 21: Type check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

```bash
git add src/story/sequence.ts src/story/sequence.test.ts src/story/sequence.data.test.ts
git commit -m "feat(story): port the original sequence builder"
```

## Part E: Findings and open questions

- [x] **Action 22: Update the checklist and open questions**

In `docs/re/story.md`, `Side-by-side checklist`, set these rows (line numbers from `rg -n "^export function|^function|^export class" src/story/random.ts src/story/calendar.ts src/story/sequence.ts`):

| Original | Ours | Status |
| --- | --- | --- |
| `1000:01f4`, `1000:020f` | `src/story/calendar.ts` `wallClockOf` (`Date`) | match |
| `1000:082c` | `src/story/random.ts` `seedRandom` (caller passes `Date.now() / 1000`) | match |
| `1018:0c21` | `src/story/calendar.ts:<line>` `halfHourSlot` | fixed |
| `1018:0b87` | `src/story/sequence.ts:<line>` `advanceDays` | fixed |
| `1018:0d50` | `src/story/sequence.ts:<line>` `pickScene` | fixed |
| `1018:0e7b` | `none (unreferenced)` | match |
| `1018:0eb5` | `src/story/sequence.ts:<line>` `fitsIsland` | fixed |
| `1018:089b` | `src/story/sequence.ts:<line>` `buildQueue` | fixed |
| `1018:1e60` | `src/story/random.ts:<line>` `StoryRandom.next` | fixed |
| `1018:1eb6` | `src/story/random.ts:<line>` `StoryRandom.discard` | fixed |
| `1018:1ed4` | `src/story/random.ts:<line>` `seedRandom` | fixed |
| `1018:1ef5` | `src/story/random.ts:<line>` `percentPick` | fixed |

`1018:0540` and `1018:0673` stay `open` until step 7 adds the wipe, the ADS unload, and the island drawing around `newSequence`. `1010:1c41` is in `docs/re/island.md` (step 4); point it at `src/story/sequence.ts` `applySceneFlags` there.

In `docs/re/open-questions.md`:

- Move OQ-6 to `Resolved` with: `**Resolution:** the original has no fallback. 1018:0d50 returns no entry when nothing matches; 1018:089b re-picks the closing scene until one is found (every slot has candidates, docs/re/story.md, Sequence building) and stops the middle when a middle pick finds nothing. src/story/sequence.ts follows it; the old picker is deleted in step 7.` and `**Status:** resolved (chunk 7)`.
- Add under `Not reviewed on purpose`:

```markdown
### OQ-34: Story guards where the original reads through a null entry

- **Where:** `src/story/sequence.ts` (`buildQueue`, `newSequence`)
- **What it does:** when the opening pick finds no entry, ours returns an empty queue (the next story step builds a new sequence); when the queue is empty, Johnny keeps his spot and heading.
- **Original:** `1018:089b` queues the null pointer at the head and reads its length and flags from data-segment offsets 7, 0x0b, 0x0d; `1018:0540` reads Johnny's spot and heading from offsets 3 and 4. The null head makes `1018:06bf` start a new sequence on the next step, as ours does.
- **Data:** <from step 2, Action 6: whether any traced build hit it, and from step 1, Action 7: which slots have no opening candidate>
- **Why not reviewed:** the original reads unrelated memory there; no port can match it.
- **Status:** open, by choice
```

- [x] **Action 23: Commit**

```bash
git add docs/re/story.md docs/re/open-questions.md
git commit -m "docs(re): story sequence port checked against the original"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
