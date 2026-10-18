# Step 4: ADS Tick

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-003-ads-state-and-script.md` (code), `step-002-original-ads-trace.md` (fixture, for the data test only)

**Files:**

- Create: `src/ads/tick.ts`, `src/testing/ads-trace.ts`
- Test: `src/ads/tick.test.ts`, `src/ads/tick.data.test.ts`
- Modify: `src/testing/ttm-recorder.ts` (export two constants), `scripts/re/names.json` (statuses), `docs/re/function-map.md` (regenerated), `docs/re/ads.md` (checklist, `Emulated`)

**Interfaces:**

- Consumes (from step 3, `src/ads/state.ts`): `NO_PAGE`, `NO_SECTION`, `MODE_IDLE`, `MODE_ONCE`, `MODE_REPEAT`, `MODE_TIMED`, `MODE_DONE`, `MODE_HOLD`, `SECTION_RUN`, `SECTION_STOP`, `SECTION_RESTART`, `SECTION_START`, `SECTION_FREEZE`, `SECTION_HIDE`, `SECTION_FRESH`, `AdsNode` (`ttmId`, `tag`, `tagPage`, `page`, `nextPage`, `lastRunPage`, `selfGoto`, `replay`, `delay`, `dueTime`, `sectionState`, `playCount`, `mode`, `playsLeft`, `endTime`, plus the `TtmThread` fields), `AdsSection { tag; start; state; counter; resume: number | null; scenes: AdsNode[] }`, `AdsState { bytecode; nodes; sections; current; endBlock; conditionTrue; now; random }`, `makeAdsState(ads, archive, random)`, `resetNode(node)`, `findNode(state, ttmId, tag)`, `sectionIndex(state, tag)`. From `src/ads/script.ts`: `runBlock(state, from)`, `sectionResumePoint(state, start)`. From `src/testing/ads-build.ts`: `ttmPayload(...pages)`, `adsPayload(ttms, script)`, `archiveOf(files)`. From chunk 5: `runTtmPage(env, thread, page): { ran; delay: number | null; gotoPage: number | null; purge }`, `activatePendingPalette(env, palette)`, `makeTtmEnv(device, draw)`, `TtmEnv` (`src/ttm/page-runner.ts`); `loadThreadDrawState(thread, draw)`, `resetDrawClip(draw)` (`src/ttm/state.ts`); `RecordingDevice(draw, archive)` with `events: [string, ...(string | number)[]][]` and `random()` (`src/testing/ttm-recorder.ts`); `makeDrawState()` (`src/gfx/gdi/surface.ts`); `makePalette()` (`src/gfx/palette.ts`); `hasFixture`, `loadArchive`, `readFixtureRows` (`src/testing/corpus.ts`, `readFixtureRows` drops the header row).
- Produces (used by step 5): `src/ads/tick.ts`: `adsStartSection(state, tag): void` (`1048:0874`), `adsSectionBusy(state, tag): boolean` (`1048:0766`), `adsTick(state, env, palette, now): boolean` (`1048:1acb`), `advancePage(node, now): boolean` (`1048:196e`), `adsActiveNodeCount(state): number` (for the debug HUD). `src/testing/ads-trace.ts`: `traceAdsSection(archive, name, tag): string[]`, `ADS_TRACE_TICK_LIMIT`.

The trace format is in the overview (`Trace format`). If `docs/re/ads.md` says something different from a code block below, `ads.md` wins: change the code and its test to match, and name the difference in the commit message.

## Part A: The tick

- [x] **Action 1: Write the failing tick tests**

Create `src/ads/tick.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { makePalette } from '../gfx/palette.js';
import { adsPayload, archiveOf, ttmPayload } from '../testing/ads-build.js';
import { RecordingDevice } from '../testing/ttm-recorder.js';
import { makeTtmEnv } from '../ttm/page-runner.js';
import {
  findNode, makeAdsState, MODE_DONE, MODE_HOLD, MODE_IDLE, MODE_ONCE, MODE_REPEAT, MODE_TIMED, NO_PAGE,
  SECTION_FREEZE, SECTION_FRESH, SECTION_HIDE, SECTION_RESTART, SECTION_STOP,
} from './state.js';
import { adsSectionBusy, adsStartSection, adsTick } from './tick.js';

const TAG_1 = [0x1111, 1];
const START_ONCE = [0x1330, 1, 1, 0x2005, 1, 1, 0, 1];

function setup(ttm: Uint8Array, section: number[]) {
  const draw = makeDrawState();
  const device = new RecordingDevice(draw, archiveOf({}));
  const env = makeTtmEnv(device, draw);
  const script = [1, ...section, 0xffff];
  const state = makeAdsState(decodeAds(adsPayload([[1, 'A.TTM']], script)), archiveOf({ 'A.TTM': ttm }), () => 0);
  const palette = makePalette();
  adsStartSection(state, 1);
  const node = (tag = 1) => findNode(state, 1, tag)!;
  return { state, device, node, tick: (now: number) => adsTick(state, env, palette, now) };
}

describe('adsStartSection', () => {
  it('restarts a section and forgets where it stopped', () => {
    // SCRANTIC 1048:0874 1048:0805
    const { state } = setup(ttmPayload(TAG_1), [0x1510]);
    state.sections[0]!.resume = 4;
    state.sections[0]!.state = SECTION_STOP;
    adsStartSection(state, 1);
    expect([state.sections[0]!.state, state.sections[0]!.resume]).toEqual([SECTION_RESTART, null]);
    expect(setup(ttmPayload(TAG_1), [0x1510]).state.sections[0]!.state).toBe(SECTION_FRESH | SECTION_RESTART);
  });
});

describe('adsTick', () => {
  it('plays a scene through: started, first page, purge, done, idle, section stopped', () => {
    // SCRANTIC 1048:1acb 1048:1223 1048:0db6 1048:196e 1048:1669 1048:0766
    const { state, node, tick } = setup(ttmPayload(TAG_1, [0x0110]), [
      ...START_ONCE, 0x1510,
      0x1350, 1, 1, 0xf010, 0xffff, 0x1510,
    ]);
    expect(tick(1)).toBe(true);
    expect([node().mode, node().page, node().lastRunPage, node().playCount, node().replay]).toEqual([MODE_ONCE, 1, 0, 1, false]);
    expect(adsSectionBusy(state, 1)).toBe(true);
    expect(tick(2)).toBe(true);
    expect([node().mode, node().page, node().nextPage, node().lastRunPage]).toEqual([MODE_DONE, 0, NO_PAGE, 1]);
    expect(adsSectionBusy(state, 1)).toBe(true);
    expect(tick(4)).toBe(false);
    expect([node().mode, node().lastRunPage, state.sections[0]!.state]).toEqual([MODE_IDLE, NO_PAGE, SECTION_STOP]);
    expect(adsSectionBusy(state, 1)).toBe(false);
  });

  it('turns a page delay into a due time and replays the page until it is due', () => {
    // SCRANTIC 1048:1acb 1048:196e
    const { node, tick } = setup(ttmPayload([...TAG_1, 0x1021, 5], [0x1021, 5]), [...START_ONCE, 0x1510]);
    tick(10);
    expect([node().page, node().delay, node().dueTime, node().replay]).toEqual([0, 5, 15, true]);
    tick(12);
    expect([node().page, node().dueTime, node().replay, node().lastRunPage]).toEqual([0, 15, true, 0]);
    tick(15);
    expect([node().page, node().dueTime, node().replay]).toEqual([1, 20, false]);
  });

  it('marks a scene whose page jumps to itself, and the busy check ignores it', () => {
    // SCRANTIC 1048:1acb 1048:0766 1058:0fc3
    const { state, node, tick } = setup(ttmPayload([...TAG_1, 0x1201, 1]), [...START_ONCE, 0x1510, 0xf010, 0xffff]);
    tick(1);
    expect([node().mode, node().page, node().selfGoto, state.sections[0]!.state]).toEqual([MODE_ONCE, 0, true, SECTION_STOP]);
    expect(adsSectionBusy(state, 1)).toBe(false);
  });

  it('keeps a stopped section busy while one of its scenes still plays', () => {
    // SCRANTIC 1048:0766
    const { state, node, tick } = setup(ttmPayload(TAG_1, []), [...START_ONCE, 0x1510, 0xf010, 0xffff]);
    tick(1);
    expect([node().mode, node().selfGoto, state.sections[0]!.state]).toEqual([MODE_ONCE, false, SECTION_STOP]);
    expect(adsSectionBusy(state, 1)).toBe(true);
  });

  it('sends a repeated scene back to its tag page after each purge until its plays run out', () => {
    // SCRANTIC 1048:1acb 1048:0db6
    const { node, tick } = setup(ttmPayload([...TAG_1, 0x0110]), [0x1330, 1, 1, 0x2005, 1, 1, 2, 1, 0x1510]);
    tick(1);
    expect([node().mode, node().playsLeft, node().page]).toEqual([MODE_REPEAT, 0, 0]);
    tick(2);
    expect([node().mode, node().page]).toEqual([MODE_DONE, 0]);
  });

  it('loops a timed scene until its end time, then marks it done', () => {
    // SCRANTIC 1048:0db6 1048:1acb
    const { node, tick } = setup(ttmPayload([...TAG_1, 0x0110]), [0x1330, 1, 1, 0x2005, 1, 1, 0xfff6, 1, 0x1510]);
    tick(1);
    expect([node().mode, node().endTime, node().page]).toEqual([MODE_TIMED, 11, 0]);
    tick(5);
    expect(node().mode).toBe(MODE_TIMED);
    tick(11);
    expect(node().mode).toBe(MODE_DONE);
  });

  it('replays a held scene page without advancing', () => {
    // SCRANTIC 1048:0e6e 1048:1acb
    const { node, tick } = setup(ttmPayload(TAG_1, []), [...START_ONCE, 0x2015, 1, 1, 1, 0x1510]);
    tick(1);
    expect([node().mode, node().page, node().replay]).toEqual([MODE_HOLD, 0, true]);
    tick(2);
    expect([node().page, node().lastRunPage]).toEqual([0, 0]);
  });

  it('ends a scene at its tag page when its page does not run', () => {
    // SCRANTIC 1050:074a 1048:1acb
    const { node, tick } = setup(ttmPayload(TAG_1), [...START_ONCE, 0x1510]);
    tick(1);
    expect(node().page).toBe(1);
    tick(2);
    expect([node().mode, node().page, node().nextPage, node().lastRunPage]).toEqual([MODE_DONE, 1, 0, NO_PAGE]);
  });

  it('runs scenes in node-list order, so 0x4000 makes a scene draw last', () => {
    // SCRANTIC 1048:1acb 1048:0f8c
    const { device, tick } = setup(ttmPayload([...TAG_1, 0xc051, 11], [0x1111, 2, 0xc051, 22]), [
      ...START_ONCE, 0x2005, 1, 2, 0, 1, 0x4000, 1, 1, 1, 0x1510,
    ]);
    tick(1);
    expect(device.events.filter(([event]) => event === 'sound').map(([, sample]) => sample)).toEqual([22, 11]);
  });

  it('skips the scenes of a hidden section and freezes those of a frozen one', () => {
    // SCRANTIC 1048:1acb
    const hidden = setup(ttmPayload(TAG_1, []), [0x2005, 1, 1, 0, 1]);
    hidden.state.sections[0]!.state = SECTION_HIDE;
    hidden.node().mode = MODE_ONCE;
    expect(hidden.tick(1)).toBe(false);
    expect([hidden.node().lastRunPage, hidden.node().page, hidden.node().sectionState]).toEqual([NO_PAGE, 0, SECTION_HIDE]);

    const frozen = setup(ttmPayload(TAG_1, []), [0x2005, 1, 1, 0, 1]);
    frozen.state.sections[0]!.state = SECTION_FREEZE;
    frozen.node().mode = MODE_ONCE;
    expect(frozen.tick(1)).toBe(false);
    expect([frozen.node().mode, frozen.node().page, frozen.node().replay]).toEqual([MODE_ONCE, 0, false]);
  });
});
```

How the expectations follow from the overview's `Tick` and `Page advance` facts:

- Every script starts with `0x1330 1 1` (the scene was never played), so its `0x2005` runs on the first tick only.
- `ttmPayload(TAG_1, [0x0110])`: page 0 is the tag page, page 1 purges. Tick 1 runs page 0 and advances to 1; tick 2 runs page 1, the purge sends `nextPage` to the tag page, the advance moves there and, mode 1, the scene is done; tick 4: the `0x1350` block sees it done and stops the section, and the done node turns idle.
- Delay 5 at clock 10 → due 15; the page replays at 12 (not due) and advances at 15 with a new due time 20.
- The goto test's page 0 jumps to tag 1, which is page 0 itself.
- A timed scene with count `0xfff6` (−10) at clock 1 ends at 11.

Run: `fnm use`, then `pnpm exec vitest run src/ads/tick.test.ts`
Expected: FAIL, cannot resolve `./tick.js`.

- [x] **Action 2: Write the tick**

Create `src/ads/tick.ts`:

```ts
import { activatePendingPalette, runTtmPage, type TtmEnv } from '../ttm/page-runner.js';
import { loadThreadDrawState, resetDrawClip } from '../ttm/state.js';
import type { Palette } from '../types.js';
import { runBlock, sectionResumePoint } from './script.js';
import {
  MODE_DONE, MODE_HOLD, MODE_IDLE, MODE_ONCE, MODE_REPEAT, MODE_TIMED, NO_PAGE, NO_SECTION, resetNode,
  SECTION_FREEZE, SECTION_FRESH, SECTION_HIDE, SECTION_RESTART, SECTION_RUN, SECTION_START, sectionIndex,
  type AdsNode, type AdsSection, type AdsState,
} from './state.js';

const PLAYING_MODES: ReadonlySet<number> = new Set([MODE_ONCE, MODE_REPEAT, MODE_TIMED, MODE_HOLD]);

export function adsStartSection(state: AdsState, tag: number): void {
  const index = sectionIndex(state, tag);
  if (index === NO_SECTION) return;
  const section = state.sections[index]!;
  section.resume = null;
  section.state = (section.state & SECTION_FRESH) | SECTION_RESTART;
}

export function adsSectionBusy(state: AdsState, tag: number): boolean {
  const index = sectionIndex(state, tag);
  if (index === NO_SECTION) return false;
  const section = state.sections[index]!;
  const running = section.state & ~SECTION_FRESH;
  if (running === SECTION_RUN || running === SECTION_START) return true;
  return section.scenes.some((node) => node.mode !== MODE_IDLE && node.mode !== MODE_DONE && !node.selfGoto);
}

export function adsActiveNodeCount(state: AdsState): number {
  return state.nodes.filter((node) => PLAYING_MODES.has(node.mode)).length;
}

export function advancePage(node: AdsNode, now: number): boolean {
  if (node.delay !== 0) {
    if (now < node.dueTime) return false;
    node.dueTime = (now + node.delay) >>> 0;
  }
  node.replay = false;
  if (node.nextPage === NO_PAGE) {
    node.page++;
  } else {
    node.page = node.nextPage;
    node.nextPage = NO_PAGE;
  }
  return true;
}

export function adsTick(state: AdsState, env: TtmEnv, palette: Palette, now: number): boolean {
  state.now = now;
  for (const section of state.sections) {
    const running = section.state & ~SECTION_FRESH;
    for (const node of section.scenes) {
      if (running === SECTION_RESTART) resetNode(node);
      else node.sectionState = running;
    }
  }
  state.sections.forEach((section, index) => runSection(state, section, index));
  let ran = false;
  for (const node of state.nodes) {
    if (playNode(env, node, now)) ran = true;
  }
  activatePendingPalette(env, palette);
  resetDrawClip(env.draw);
  return ran;
}

function runSection(state: AdsState, section: AdsSection, index: number): void {
  let start: number;
  if (section.state & SECTION_FRESH) {
    section.state &= ~SECTION_FRESH;
    start = section.start;
  } else {
    start = sectionResumePoint(state, section.start);
  }
  const from = section.resume ?? start;
  if (section.state === SECTION_RESTART || section.state === SECTION_START) section.state = SECTION_RUN;
  state.current = index;
  if (section.state === SECTION_RUN) runBlock(state, from);
}

function playNode(env: TtmEnv, node: AdsNode, now: number): boolean {
  node.lastRunPage = NO_PAGE;
  const section = node.sectionState;
  const mode = node.mode;
  let ran = false;
  if (section !== SECTION_HIDE && PLAYING_MODES.has(mode)) {
    loadThreadDrawState(node, env.draw);
    const result = runTtmPage(env, node, node.page);
    if (!result.ran || section === SECTION_FREEZE) {
      if (section !== SECTION_FREEZE) {
        node.nextPage = node.tagPage;
        node.mode = MODE_DONE;
      }
    } else {
      ran = true;
      node.replay = true;
      node.lastRunPage = node.page;
      if (result.delay !== null && result.delay !== node.delay) {
        node.dueTime = (now + result.delay) >>> 0;
        node.delay = result.delay;
      }
      if (!result.purge) {
        if (result.gotoPage !== null) {
          node.nextPage = result.gotoPage;
          if (node.page === result.gotoPage) node.selfGoto = true;
        }
        if (node.mode !== MODE_HOLD) advancePage(node, now);
      } else {
        node.nextPage = node.tagPage;
        if (node.mode === MODE_REPEAT && node.playsLeft !== 0) {
          if (advancePage(node, now)) node.playsLeft--;
        } else if (node.mode === MODE_TIMED && node.endTime !== 0) {
          advancePage(node, now);
        } else if (advancePage(node, now)) {
          node.mode = MODE_DONE;
          node.delay = 0;
        }
      }
    }
  } else if (section !== SECTION_HIDE && section !== SECTION_FREEZE && mode === MODE_DONE) {
    node.mode = MODE_IDLE;
  }
  if (mode === MODE_TIMED && node.endTime <= now) node.mode = MODE_DONE;
  return ran;
}
```

`runTtmPage` takes a `TtmThread`; an `AdsNode` is one. The node's `replay` flag is the original's `[7]`, which the page runner reads to skip loads and sounds on replays.

- [x] **Action 3: Run the tick tests**

Run: `pnpm exec vitest run src/ads/tick.test.ts`
Expected: all PASS.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [x] **Action 4: Commit**

```bash
git add src/ads/tick.ts src/ads/tick.test.ts
git commit -m "feat(ads): port the original ADS tick, page advance, start, and busy check"
```

## Part B: Equal to the original on the corpus

- [x] **Action 5: Export the trace island offsets**

In `src/testing/ttm-recorder.ts`, change

```ts
const TRACE_ISLAND_X = 7;
const TRACE_ISLAND_Y = 5;
```

to

```ts
export const TRACE_ISLAND_X = 7;
export const TRACE_ISLAND_Y = 5;
```

- [x] **Action 6: Write the trace builder**

Check the tick limit the Python harness ended up with: `rg -n "^TICK_LIMIT" scripts/re/unicorn/original_ads.py`. Use the same number below (2000 unless step 2 lowered it).

Create `src/testing/ads-trace.ts`:

```ts
import { makeAdsState, type AdsNode } from '../ads/state.js';
import { adsSectionBusy, adsStartSection, adsTick } from '../ads/tick.js';
import { decodeAds } from '../decode/ads-loader.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { makePalette } from '../gfx/palette.js';
import type { ParsedArchive } from '../resource/types.js';
import { makeTtmEnv } from '../ttm/page-runner.js';
import { RecordingDevice, TRACE_ISLAND_X, TRACE_ISLAND_Y } from './ttm-recorder.js';

export const ADS_TRACE_TICK_LIMIT = 2000;
const CLOCK_START = 1;

export function traceAdsSection(archive: ParsedArchive, name: string, tag: number): string[] {
  const draw = makeDrawState();
  const device = new RecordingDevice(draw, archive);
  const env = makeTtmEnv(device, draw);
  env.islandX = TRACE_ISLAND_X;
  env.islandY = TRACE_ISLAND_Y;
  const state = makeAdsState(decodeAds(archive.byName.get(name)!.payload), archive, () => device.random());
  const palette = makePalette();
  adsStartSection(state, tag);
  const rows: string[] = [];
  let seenOrder: string | null = null;
  const seenSections = new Map<number, string>();
  const seenNodes = new Map<AdsNode, string>();
  let now = CLOCK_START;
  for (let tick = 0; tick < ADS_TRACE_TICK_LIMIT; tick++) {
    device.events = [];
    const ran = adsTick(state, env, palette, now);
    const busy = adsSectionBusy(state, tag);
    const randoms = device.events.filter(([event]) => event === 'random').length;
    const out: (string | number)[][] = [['tick', ran ? 1 : 0, busy ? 1 : 0, randoms]];
    const order = state.nodes.map((node) => `${node.ttmId}:${node.tag}`).join(' ');
    if (order !== seenOrder) {
      out.push(['order', order]);
      seenOrder = order;
    }
    state.sections.forEach((section, index) => {
      const values = [section.state, section.counter, section.resume ?? -1].join(' ');
      if (seenSections.get(index) === values) return;
      out.push(['section', index, values]);
      seenSections.set(index, values);
    });
    for (const node of state.nodes) {
      const values = nodeValues(node).join(' ');
      if (seenNodes.get(node) === values) continue;
      out.push(['node', values]);
      seenNodes.set(node, values);
    }
    for (const [event, ...values] of out) rows.push([name, tag, tick, event, values.join(' ')].join('\t'));
    if (!busy) break;
    now += 1 + (tick % 3);
  }
  return rows;
}

function nodeValues(node: AdsNode): number[] {
  return [
    node.ttmId, node.tag, node.mode, node.page, node.nextPage, node.lastRunPage, node.selfGoto ? 1 : 0,
    node.replay ? 1 : 0, node.playCount, node.playsLeft, node.sectionState, node.delay, node.dueTime, node.endTime,
  ];
}
```

The ADS random picks call `device.random()`, so they share the recorder's call counter with the TTM `0x2022` delays, as both share `1018:1e60` in the original.

- [x] **Action 7: Write the corpus comparison**

Create `src/ads/tick.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { traceAdsSection } from '../testing/ads-trace.js';
import { hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';

describe.skipIf(!hasFixture('ads/traces.tsv'))('ADS tick matches the original SCRANTIC.SCR', () => {
  it('makes the same scene, section, and page decisions on every section of every ADS script', { timeout: 600_000 }, () => {
    // SCRANTIC 1048:0079 1048:0874 1048:1acb 1048:1925 1048:1519 1048:1223 1048:0cda 1048:196e 1048:0766
    const archive = loadArchive();
    const original = new Map<string, string[]>();
    for (const [ads, tag, tick, event, values] of readFixtureRows('ads/traces.tsv')) {
      const key = `${ads} ${tag}`;
      if (!original.has(key)) original.set(key, []);
      original.get(key)!.push([ads, tag, tick, event, values ?? ''].join('\t'));
    }
    const sections = archive.list
      .filter((resource) => resource.type === '.ADS')
      .flatMap((resource) => decodeAds(resource.payload).sections.map((section) => `${resource.name} ${section.tag}`));
    expect([...original.keys()].sort()).toEqual([...new Set(sections)].sort());
    const wrong: string[] = [];
    for (const [key, rows] of original) {
      const [ads, tag] = key.split(' ');
      const ours = traceAdsSection(archive, ads!, Number(tag));
      const at = ours.findIndex((row, i) => row !== rows[i]);
      if (at >= 0) wrong.push(`${key} row ${at}: ours ${ours[at]}; original ${rows[at] ?? '(end)'}`);
      else if (ours.length !== rows.length) wrong.push(`${key}: ours ${ours.length} rows, original ${rows.length}`);
    }
    expect(wrong).toEqual([]);
  });
});
```

If an ADS has two sections with the same tag, the key list will not match (both the dump and `1048:19e7` only ever start the first). In that case, say so in `docs/re/ads.md` (`Sections`) and compare only the first.

- [x] **Action 8: Run it and fix every difference**

Run: `pnpm exec vitest run src/ads/tick.data.test.ts`
Expected: PASS. It may take minutes.

When it fails, each entry names the section, the first differing row, ours, and the original. Work through them one section at a time:

1. Read the original row against `docs/re/ads.md`. Find which function decided that value (the `Tick`, `Page advance`, `Blocks`, or `Conditions` facts).
2. If `ads.md` is right and our code differs: fix `src/ads/*.ts`, add a unit test in `tick.test.ts` or `script.test.ts` that pins the case with its address, rerun.
3. If `ads.md` is wrong or incomplete: read the assembly again, fix the bullet, then the code and test.
4. If the difference comes from the page runner (a `node` row where only `page`, `delay`, or `nextPage` differs right after a page ran, and the TTM is the same): compare that page in `re/fixtures/ttm/traces.tsv` with `src/ttm/page-runner.data.test.ts`; that would be a chunk 5 bug. Fix it there, with a test.
5. A difference that cannot be explained after reading the code twice: record it in `docs/re/open-questions.md` as a new entry (next free number after OQ-31) with the section, row, both values, and the functions involved, and leave the data test failing only if the user agrees; otherwise stop and ask.

Run: `pnpm test`
Expected: all PASS.

- [x] **Action 9: Commit**

```bash
git add src/testing/ttm-recorder.ts src/testing/ads-trace.ts src/ads/tick.data.test.ts src/ads
git commit -m "test(ads): the ADS tick matches the original on every section"
```

## Part C: Docs

- [x] **Action 10: Mark what is now verified**

In `scripts/re/names.json`, set `"status": "verified"` for every function whose port is now checked by the corpus trace or by unit tests against the findings: `1048:0079`, `040f`, `0766`, `0805`, `0874`, `0b3e`, `0bc5`, `0bf4`, `0c30`, `0c8d`, `0cda`, `0db6`, `0e2e`, `0e6e`, `0e9b`, `0ec8`, `0ef2`, `0f8c`, `106b`, `118a`, `11db`, `1223`, `1519`, `1925`, `196e`, `19e7`, `1acb`. Leave the others for step 6. Then run `node scripts/re/function-map.mjs`.

- [x] **Action 11: Update `docs/re/ads.md`**

In `Side-by-side checklist`, replace the rows of the functions this step ported (status `fixed`, `Ours` with `file:line` from `rg -n "function <name>" src/ads/tick.ts`):

| Original | Ours |
| --- | --- |
| `1048:0766` | `src/ads/tick.ts` `adsSectionBusy` |
| `1048:0805`, `1048:0874` | `src/ads/tick.ts` `adsStartSection` |
| `1048:196e` | `src/ads/tick.ts` `advancePage` |
| `1048:1acb` | `src/ads/tick.ts` `adsTick`, `runSection`, `playNode` |

In `Emulated`, add one bullet: `src/ads/tick.data.test.ts` runs `traceAdsSection` (`src/testing/ads-trace.ts`) on every section and finds no difference with `re/fixtures/ads/traces.tsv`, plus a sentence for each fix Action 8 needed (what was wrong, the address that settled it).

- [x] **Action 12: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md docs/re/ads.md docs/re/open-questions.md
git commit -m "docs(re): ADS tick verified against the original"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
