# Step 3: ADS State and Script Interpreter

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-ads-findings.md` (`docs/re/ads.md`)

**Files:**

- Create: `src/testing/ads-build.ts`, `src/ads/state.ts`, `src/ads/script.ts`
- Test: `src/ads/state.test.ts`, `src/ads/script.test.ts`
- Modify: `docs/re/ads.md` (checklist rows), `docs/re/open-questions.md` (OQ-31)

**Interfaces:**

- Consumes: `decodeAds(payload): AdsResource` with `subResources: { slot; name }[]`, `bytecode`, `sections: { tag; offset }[]` (`src/decode/ads-loader.ts`); `adsArgCount(opcode)` (`src/decode/ads-bytecode.ts`); `decodeTtm(payload): { tags: { id; page }[]; ... }` (`src/decode/ttm-loader.ts`); `makeThread(slot): TtmThread`, `makeTtmSlot(id, ttm): TtmSlot`, `TtmThread` (fields the page runner uses: `slot`, `replay`, `paletteSlot`, `bmpSlot`, `zoneSlot`, `foreground`, `background`, `clipOn`, `clip`; until step 5 it also still has `delay`, `tagPage`, `page`, `nextPage` and old scheduler fields) (`src/ttm/state.ts`); `ParsedArchive { byName: Map<string, { name; type; payload }>; list }` (`src/resource/types.ts`); `ascii`, `words`, `concat`, `chunk(tag, body, container?)`, `storedBody(data)` (`src/testing/build-chunks.ts`); `SCREEN_W`, `SCREEN_H` (`src/types.ts`).
- Produces (used by step 4 and 5):
  - `src/ads/state.ts`: constants `NO_PAGE = -1`, `NO_SECTION = -1`, `MODE_IDLE = 0`, `MODE_ONCE = 1`, `MODE_REPEAT = 2`, `MODE_TIMED = 3`, `MODE_DONE = 4`, `MODE_HOLD = 5`, `SECTION_IDLE = 0`, `SECTION_RUN = 1`, `SECTION_STOP = 2`, `SECTION_RESTART = 3`, `SECTION_START = 4`, `SECTION_FREEZE = 5`, `SECTION_HIDE = 6`, `SECTION_FRESH = 8`; types `AdsNode` (extends `TtmThread` with `ttmId`, `tag`, `tagPage`, `page`, `nextPage`, `lastRunPage`, `selfGoto`, `delay`, `dueTime`, `sectionState`, `playCount`, `mode`, `playsLeft`, `endTime`), `AdsSection { tag; start; state; counter; resume: number | null; scenes: AdsNode[] }`, `AdsState { bytecode; nodes: AdsNode[]; sections: AdsSection[]; current; endBlock; conditionTrue; now; random: () => number }`; functions `makeAdsState(ads, archive, random): AdsState`, `resetNode(node)`, `findNode(state, ttmId, tag): AdsNode | null`, `sectionIndex(state, tag): number`, `word(state, at): number`, `nextInstruction(state, at: number | null): number | null`.
  - `src/ads/script.ts`: `ADS_OP` (named opcodes), `runBlock(state, from: number | null): number | null` (`1048:1925`), `runInstruction(state, at): number | null` (`1048:1519`), `sectionResumePoint(state, start): number` (`1048:0c30`).
  - `src/testing/ads-build.ts`: `ttmPayload(...pages: number[][])`, `adsPayload(ttms: [number, string][], script: number[])`, `archiveOf(files: Record<string, Uint8Array>): ParsedArchive`.

Positions in the bytecode are byte offsets into `AdsState.bytecode`; `null` stands for the original's null far pointer. The old `src/ads/scheduler.ts` stays untouched in this step; the engine keeps using it until step 5.

If `docs/re/ads.md` says something different from a code block below, `ads.md` wins: change the code and its test to match, and name the difference in the commit message.

## Part A: State

- [ ] **Action 1: Write the test-data builders**

Create `src/testing/ads-build.ts`:

```ts
import type { ParsedArchive } from '../resource/types.js';
import { ascii, chunk, concat, storedBody, words } from './build-chunks.js';

const PAGE_END = 0x0ff0;

export function ttmPayload(...pages: number[][]): Uint8Array {
  const bytecode = words(...pages.flatMap((page) => [...page, PAGE_END]));
  return concat(chunk('VER:', ascii('4.09\0')), chunk('PAG:', words(pages.length)), chunk('TT3:', storedBody(bytecode)));
}

export function adsPayload(ttms: [number, string][], script: number[]): Uint8Array {
  const res = concat(words(ttms.length), ...ttms.map(([id, name]) => concat(words(id), ascii(`${name}\0`))));
  const ads = concat(chunk('RES:', res), chunk('SCR:', storedBody(words(...script))));
  return concat(chunk('VER:', ascii('4.09\0')), chunk('ADS:', ads, true));
}

export function archiveOf(files: Record<string, Uint8Array>): ParsedArchive {
  const list = Object.entries(files).map(([name, payload]) => ({ name, type: name.slice(-4), payload }));
  return { byName: new Map(list.map((resource) => [resource.name, resource])), list };
}
```

- [ ] **Action 2: Write the failing state tests**

Create `src/ads/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { adsPayload, archiveOf, ttmPayload } from '../testing/ads-build.js';
import { findNode, makeAdsState, MODE_DONE, MODE_IDLE, NO_PAGE, resetNode, SECTION_FRESH } from './state.js';

const A_TTM = ttmPayload([0x1111, 1], [0x1111, 2]);

describe('makeAdsState', () => {
  it('makes one reset node per 0x1111 tag of every listed TTM, in ADS:RES: order', () => {
    // SCRANTIC 1048:0079 1050:042a 1048:0bc5 1048:0b3e
    const ads = decodeAds(adsPayload([[1, 'A.TTM'], [2, 'B.TTM']], [1, 0xffff]));
    const archive = archiveOf({ 'A.TTM': A_TTM, 'B.TTM': ttmPayload([0x1111, 7]) });
    const state = makeAdsState(ads, archive, () => 0);
    expect(state.nodes.map((n) => [n.ttmId, n.tag, n.tagPage, n.page, n.mode, n.foreground, n.slot.id])).toEqual([
      [1, 1, 0, 0, MODE_IDLE, 15, 1],
      [1, 2, 1, 1, MODE_IDLE, 15, 1],
      [2, 7, 0, 0, MODE_IDLE, 15, 2],
    ]);
  });

  it('starts every section fresh, with the distinct scenes its 0x2000 and 0x2005 name', () => {
    // SCRANTIC 1048:04fc 1048:040f 1068:260a
    const script = [
      1, 0x2005, 1, 2, 0, 1, 0x2005, 1, 2, 0, 1, 0x2005, 9, 9, 0, 1, 0x2000, 1, 1, 0, 1, 0x2010, 1, 3, 1, 0xffff,
      2, 0x1510, 0xffff,
    ];
    const state = makeAdsState(decodeAds(adsPayload([[1, 'A.TTM']], script)), archiveOf({ 'A.TTM': A_TTM }), () => 0);
    expect(state.sections.map((s) => [s.tag, s.state, s.counter, s.resume])).toEqual([
      [1, SECTION_FRESH, 0, null],
      [2, SECTION_FRESH, 0, null],
    ]);
    expect(state.sections[0]!.start).toBe(2);
    expect(state.sections[0]!.scenes.map((n) => n.tag)).toEqual([2, 1]);
    expect(state.sections[1]!.scenes).toEqual([]);
  });

  it('does not load when a listed TTM is missing', () => {
    // SCRANTIC 1048:0079 1048:001b
    const ads = decodeAds(adsPayload([[1, 'A.TTM'], [2, 'B.TTM']], [1, 0xffff]));
    expect(() => makeAdsState(ads, archiveOf({ 'A.TTM': A_TTM }), () => 0)).toThrow(/B\.TTM/);
  });
});

describe('resetNode', () => {
  it('rewinds a node to its tag page and clears its play state, but not its end time or last run page', () => {
    // SCRANTIC 1048:0b3e
    const state = makeAdsState(decodeAds(adsPayload([[1, 'A.TTM']], [1, 0xffff])), archiveOf({ 'A.TTM': A_TTM }), () => 0);
    const node = findNode(state, 1, 2)!;
    Object.assign(node, {
      page: 7, nextPage: 3, mode: MODE_DONE, playCount: 4, playsLeft: 2, delay: 9, dueTime: 50, endTime: 60,
      replay: true, selfGoto: true, bmpSlot: 3, paletteSlot: 2, zoneSlot: 1, foreground: 2, background: 3,
      clipOn: false, clip: { x1: 5, y1: 5, x2: 9, y2: 9 }, sectionState: 4, lastRunPage: 7,
    });
    resetNode(node);
    expect([
      node.page, node.nextPage, node.mode, node.playCount, node.playsLeft, node.delay, node.dueTime, node.replay,
      node.selfGoto, node.bmpSlot, node.paletteSlot, node.zoneSlot, node.foreground, node.background, node.clipOn,
      node.sectionState,
    ]).toEqual([1, NO_PAGE, MODE_IDLE, 0, 0, 0, 0, false, false, 0, 0, 0, 15, 15, true, 0]);
    expect(node.clip).toEqual({ x1: 0, y1: 0, x2: 639, y2: 479 });
    expect([node.endTime, node.lastRunPage]).toEqual([60, 7]);
  });
});
```

Run: `fnm use`, then `pnpm exec vitest run src/ads/state.test.ts`
Expected: FAIL, cannot resolve `./state.js`.

- [ ] **Action 3: Write the state module**

Create `src/ads/state.ts`:

```ts
import { adsArgCount } from '../decode/ads-bytecode.js';
import type { AdsResource } from '../decode/ads-loader.js';
import { decodeTtm } from '../decode/ttm-loader.js';
import type { ParsedArchive } from '../resource/types.js';
import { makeThread, makeTtmSlot, type TtmSlot, type TtmThread } from '../ttm/state.js';
import { SCREEN_H, SCREEN_W } from '../types.js';

export const NO_PAGE = -1;
export const NO_SECTION = -1;

export const MODE_IDLE = 0;
export const MODE_ONCE = 1;
export const MODE_REPEAT = 2;
export const MODE_TIMED = 3;
export const MODE_DONE = 4;
export const MODE_HOLD = 5;

export const SECTION_IDLE = 0;
export const SECTION_RUN = 1;
export const SECTION_STOP = 2;
export const SECTION_RESTART = 3;
export const SECTION_START = 4;
export const SECTION_FREEZE = 5;
export const SECTION_HIDE = 6;
export const SECTION_FRESH = 8;

const SECTION_END = 0xffff;
const SCENE_OPCODES: readonly number[] = [0x2000, 0x2005];

export interface AdsNode extends TtmThread {
  ttmId: number;
  tag: number;
  tagPage: number;
  page: number;
  nextPage: number;
  lastRunPage: number;
  selfGoto: boolean;
  delay: number;
  dueTime: number;
  sectionState: number;
  playCount: number;
  mode: number;
  playsLeft: number;
  endTime: number;
}

export interface AdsSection {
  tag: number;
  start: number;
  state: number;
  counter: number;
  resume: number | null;
  scenes: AdsNode[];
}

export interface AdsState {
  bytecode: Uint8Array;
  nodes: AdsNode[];
  sections: AdsSection[];
  current: number;
  endBlock: number;
  conditionTrue: boolean;
  now: number;
  random: () => number;
}

export function makeAdsState(ads: AdsResource, archive: ParsedArchive, random: () => number): AdsState {
  const nodes: AdsNode[] = [];
  for (const { slot: ttmId, name } of ads.subResources) {
    const resource = archive.byName.get(name.toUpperCase());
    if (!resource) throw new Error(`${name} is missing, so the ADS does not load`);
    const ttm = decodeTtm(resource.payload);
    const slot = makeTtmSlot(ttmId, ttm);
    for (const { id, page } of ttm.tags) nodes.push(makeNode(slot, ttmId, id, page));
  }
  nodes.forEach(resetNode);
  const state: AdsState = {
    bytecode: ads.bytecode,
    nodes,
    sections: [],
    current: NO_SECTION,
    endBlock: 0,
    conditionTrue: false,
    now: 0,
    random,
  };
  state.sections = ads.sections.map(({ tag, offset }) => ({
    tag,
    start: offset,
    state: SECTION_FRESH,
    counter: 0,
    resume: null,
    scenes: sectionScenes(state, offset),
  }));
  return state;
}

function makeNode(slot: TtmSlot, ttmId: number, tag: number, tagPage: number): AdsNode {
  return {
    ...makeThread(slot),
    ttmId,
    tag,
    tagPage,
    page: tagPage,
    nextPage: NO_PAGE,
    lastRunPage: NO_PAGE,
    selfGoto: false,
    delay: 0,
    dueTime: 0,
    sectionState: SECTION_IDLE,
    playCount: 0,
    mode: MODE_IDLE,
    playsLeft: 0,
    endTime: 0,
  };
}

export function resetNode(node: AdsNode): void {
  node.paletteSlot = 0;
  node.bmpSlot = 0;
  node.zoneSlot = 0;
  node.page = node.tagPage;
  node.nextPage = NO_PAGE;
  node.foreground = 0x0f;
  node.background = 0x0f;
  node.delay = 0;
  node.dueTime = 0;
  node.playsLeft = 0;
  node.playCount = 0;
  node.replay = false;
  node.mode = MODE_IDLE;
  node.sectionState = SECTION_IDLE;
  node.selfGoto = false;
  node.clipOn = true;
  node.clip = { x1: 0, y1: 0, x2: SCREEN_W - 1, y2: SCREEN_H - 1 };
}

export function findNode(state: AdsState, ttmId: number, tag: number): AdsNode | null {
  return state.nodes.find((node) => node.ttmId === ttmId && node.tag === tag) ?? null;
}

export function sectionIndex(state: AdsState, tag: number): number {
  return state.sections.findIndex((section) => section.tag === tag);
}

export function word(state: AdsState, at: number): number {
  return (state.bytecode[at] ?? 0) | ((state.bytecode[at + 1] ?? 0) << 8);
}

export function nextInstruction(state: AdsState, at: number | null): number | null {
  if (at === null || at > state.bytecode.length - 1) return null;
  return at + 2 + 2 * adsArgCount(word(state, at));
}

function sectionScenes(state: AdsState, start: number): AdsNode[] {
  const scenes: AdsNode[] = [];
  for (let at: number | null = start; at !== null && word(state, at) !== SECTION_END; at = nextInstruction(state, at)) {
    if (!SCENE_OPCODES.includes(word(state, at))) continue;
    const node = findNode(state, word(state, at + 2), word(state, at + 4));
    if (node && !scenes.includes(node)) scenes.push(node);
  }
  return scenes;
}
```

- [ ] **Action 4: Run the state tests**

Run: `pnpm exec vitest run src/ads/state.test.ts`
Expected: 4 tests PASS.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 5: Commit**

```bash
git add src/testing/ads-build.ts src/ads/state.ts src/ads/state.test.ts
git commit -m "feat(ads): ADS record, nodes, and sections as the original builds them"
```

## Part B: Script interpreter

- [ ] **Action 6: Write the failing script tests**

Create `src/ads/script.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { adsPayload, archiveOf, ttmPayload } from '../testing/ads-build.js';
import { ADS_OP, runBlock, sectionResumePoint } from './script.js';
import {
  findNode, makeAdsState, MODE_DONE, MODE_HOLD, MODE_IDLE, MODE_ONCE, MODE_REPEAT, MODE_TIMED,
  SECTION_FRESH, SECTION_RESTART, SECTION_START, SECTION_STOP, type AdsNode, type AdsState,
} from './state.js';

const A_TTM = ttmPayload([0x1111, 1], [0x1111, 2], [0x1111, 3]);

function load(sections: number[][], random = () => 0): AdsState {
  const script = sections.flatMap((body, index) => [index + 1, ...body, ADS_OP.END]);
  return makeAdsState(decodeAds(adsPayload([[1, 'A.TTM']], script)), archiveOf({ 'A.TTM': A_TTM }), random);
}

function node(state: AdsState, tag: number): AdsNode {
  return findNode(state, 1, tag)!;
}

function pass(state: AdsState, section = 0): number | null {
  state.current = section;
  const { start, resume } = state.sections[section]!;
  return runBlock(state, resume ?? start);
}

const plays = (state: AdsState) => [1, 2, 3].map((tag) => node(state, tag).playCount);
const addScene = (tag: number, count = 0) => [ADS_OP.ADD_SCENE, 1, tag, count, 1];

describe('if blocks', () => {
  it('runs a block whose condition holds up to its 0x1510, then goes on after it', () => {
    // SCRANTIC 1048:1758 1048:1925 1048:1588
    const state = load([[0x1330, 1, 1, ...addScene(1), ADS_OP.END_IF, ...addScene(2)]]);
    expect(pass(state)).toBeNull();
    expect(plays(state)).toEqual([1, 1, 0]);
    pass(state);
    expect(plays(state)).toEqual([1, 2, 0]);
  });

  it('runs the else part when the condition fails', () => {
    // SCRANTIC 1048:11db 1048:106b 1048:1567
    const state = load([[0x1330, 1, 1, ...addScene(1), ADS_OP.ELSE, ...addScene(2), ADS_OP.END_IF]]);
    pass(state);
    expect(plays(state)).toEqual([1, 0, 0]);
    pass(state);
    expect(plays(state)).toEqual([1, 1, 0]);
  });

  it('skips a false block with nested blocks in it', () => {
    // SCRANTIC 1048:106b
    const state = load([[
      0x1350, 1, 1,
      0x1330, 1, 2, ...addScene(2), ADS_OP.END_IF,
      ...addScene(2),
      ADS_OP.END_IF,
      ...addScene(3),
    ]]);
    pass(state);
    expect(plays(state)).toEqual([0, 0, 1]);
  });

  it('joins conditions with 0x1430 (or) and 0x1420 (and)', () => {
    // SCRANTIC 1048:1223
    const chain = (doneTags: number[], ...conditions: number[]) => {
      const state = load([[...conditions, ...addScene(3), ADS_OP.END_IF]]);
      for (const tag of doneTags) node(state, tag).mode = MODE_DONE;
      pass(state);
      return node(state, 3).playCount === 1;
    };
    expect(chain([2], 0x1350, 1, 1, ADS_OP.OR, 0x1350, 1, 2)).toBe(true);
    expect(chain([2], 0x1350, 1, 1, ADS_OP.AND, 0x1350, 1, 2)).toBe(false);
    expect(chain([1, 2], 0x1350, 1, 1, ADS_OP.AND, 0x1350, 1, 2)).toBe(true);
    expect(chain([2], 0x1350, 1, 2, ADS_OP.OR, 0x1350, 1, 1, ADS_OP.AND, 0x1350, 1, 1)).toBe(true);
  });

  it('tests a scene by its mode and play count', () => {
    // SCRANTIC 1048:1223 1048:12ab
    const holds = (opcode: number, set: Partial<AdsNode>, tag = 1) => {
      const state = load([[opcode, 1, tag, ...addScene(3), ADS_OP.END_IF]]);
      Object.assign(node(state, 1), set);
      pass(state);
      return node(state, 3).playCount === 1;
    };
    expect([holds(0x1310, { mode: MODE_HOLD }), holds(0x1310, { mode: MODE_ONCE })]).toEqual([true, false]);
    expect([holds(0x1320, { mode: MODE_HOLD }), holds(0x1320, {}, 9)]).toEqual([false, true]);
    expect([holds(0x1330, {}), holds(0x1330, { playCount: 1 }), holds(0x1330, {}, 9)]).toEqual([true, false, true]);
    expect([holds(0x1340, { playCount: 1 }), holds(0x1340, {}, 9)]).toEqual([true, false]);
    expect([holds(0x1350, { mode: MODE_DONE }), holds(0x1350, { mode: MODE_IDLE })]).toEqual([true, false]);
    expect([holds(0x1360, { mode: MODE_DONE }), holds(0x1360, { mode: MODE_TIMED }), holds(0x1360, {}, 9)]).toEqual([true, false, true]);
    expect([holds(0x1370, { mode: MODE_REPEAT }), holds(0x1370, { mode: MODE_HOLD }), holds(0x1370, {}, 9)]).toEqual([true, false, false]);
  });

  it('compares 0x1380 to 0x13c1 against values nothing ever sets', () => {
    // SCRANTIC 1048:1223 1068:463a 1068:4636 1068:4638
    const holds = (opcode: number, value: number) => {
      const state = load([[opcode, value, ...addScene(3), ADS_OP.END_IF]]);
      pass(state);
      return node(state, 3).playCount === 1;
    };
    expect([holds(0x1380, 0), holds(0x1380, 0xffff)]).toEqual([true, false]);
    expect([holds(0x1390, 0), holds(0x1390, 1)]).toEqual([true, false]);
    expect([holds(0x13a0, 5), holds(0x13b1, 5), holds(0x13b0, 0), holds(0x13c1, 0), holds(0x13c0, 1)])
      .toEqual([true, false, true, true, false]);
  });
});

describe('while blocks', () => {
  it('runs a true block, ends the pass there, and resumes at it on the next pass', () => {
    // SCRANTIC 1048:17a0 1048:118a 1048:158a
    const state = load([[0x1070, 1, 1, ...addScene(2), ADS_OP.END_WHILE, ...addScene(3)]]);
    node(state, 1).mode = MODE_ONCE;
    expect(pass(state)).toBeNull();
    expect(plays(state)).toEqual([0, 1, 0]);
    expect([state.sections[0]!.counter, state.sections[0]!.resume]).toEqual([1, 2]);
    node(state, 1).mode = MODE_IDLE;
    pass(state);
    expect(plays(state)).toEqual([0, 1, 1]);
    expect([state.sections[0]!.counter, state.sections[0]!.resume]).toEqual([0, null]);
  });

  it('repeats a 0x1080 block while the section counter is at most its argument', () => {
    // SCRANTIC 1048:1223 1048:17a0
    const state = load([[ADS_OP.WHILE_COUNT, 2, ...addScene(1), ADS_OP.END_WHILE]]);
    for (let i = 0; i < 4; i++) pass(state);
    expect(node(state, 1).playCount).toBe(3);
    expect(state.sections[0]!.resume).toBeNull();
  });
});

describe('scene operations', () => {
  it('sets a scene mode from the 0x2005 count and counts the play', () => {
    // SCRANTIC 1048:0db6
    const state = load([[...addScene(1, 0), ...addScene(2, 3), ...addScene(3, 0xffce)]]);
    state.now = 100;
    pass(state);
    expect([1, 2, 3].map((tag) => {
      const n = node(state, tag);
      return [n.mode, n.playsLeft, n.endTime, n.playCount];
    })).toEqual([[MODE_ONCE, 0, 0, 1], [MODE_REPEAT, 2, 0, 1], [MODE_TIMED, 0, 150, 1]]);
  });

  it('0x2000 sends the scene back to its tag page before adding it', () => {
    // SCRANTIC 1048:0e2e
    const state = load([[ADS_OP.RESTART_SCENE, 1, 2, 0, 1]]);
    node(state, 2).page = 5;
    pass(state);
    expect([node(state, 2).page, node(state, 2).mode]).toEqual([1, MODE_ONCE]);
  });

  it('0x2010 idles, 0x2015 holds, and 0x2020 resets a scene', () => {
    // SCRANTIC 1048:0e9b 1048:0e6e 1048:0ec8
    const state = load([[ADS_OP.STOP_SCENE, 1, 1, 1, ADS_OP.HOLD_SCENE, 1, 2, 1, ADS_OP.RESET_SCENE, 1, 3, 1]]);
    for (const tag of [1, 2, 3]) Object.assign(node(state, tag), { mode: MODE_ONCE, page: 9, playCount: 2 });
    pass(state);
    expect([1, 2, 3].map((tag) => [node(state, tag).mode, node(state, tag).page, node(state, tag).playCount]))
      .toEqual([[MODE_IDLE, 9, 2], [MODE_HOLD, 9, 2], [MODE_IDLE, 2, 0]]);
  });

  it('0x4000 moves a scene to the end of the node list and 0x4010 to the front', () => {
    // SCRANTIC 1048:0f8c 1048:0ef2
    const state = load([[ADS_OP.DRAW_LAST, 1, 1, 1, ADS_OP.DRAW_FIRST, 1, 3, 1]]);
    pass(state);
    expect(state.nodes.map((n) => n.tag)).toEqual([3, 2, 1]);
  });

  it('runs one weighted pick of a random block, or nothing when 0x3020 is picked', () => {
    // SCRANTIC 1048:0cda 1048:0c8d
    const block = [
      ADS_OP.RANDOM, ...addScene(1).slice(0, 4), 3, ...addScene(2), ADS_OP.RANDOM_NOTHING, 6, ADS_OP.RANDOM_END,
      ...addScene(3),
    ];
    const pick = (random: number) => {
      const state = load([block], () => random);
      pass(state);
      return plays(state);
    };
    expect(pick(0)).toEqual([1, 0, 1]);
    expect(pick(3)).toEqual([0, 1, 1]);
    expect(pick(4)).toEqual([0, 0, 1]);
    expect(pick(0xfffd)).toEqual([0, 1, 1]);
  });
});

describe('section control', () => {
  it('0xf010 stops this section and ends the pass, or stops another section and goes on', () => {
    // SCRANTIC 1048:1669
    const state = load([
      [ADS_OP.STOP_SECTION, 2, ...addScene(1), ADS_OP.STOP_SECTION, 0xffff, ...addScene(2)],
      [],
    ]);
    pass(state);
    expect(state.sections.map((s) => s.state)).toEqual([SECTION_STOP, SECTION_STOP]);
    expect(plays(state)).toEqual([1, 0, 0]);
  });

  it('0xf000 stops this section; 0xf200 and 0xf210 start one, keeping its fresh bit', () => {
    // SCRANTIC 1048:1645 1048:16c2 1048:1709
    const state = load([[ADS_OP.START_SECTION, 2, ADS_OP.RESTART_SECTION, 3, ADS_OP.STOP_THIS_SECTION], [], []]);
    state.sections[2]!.state = SECTION_STOP;
    pass(state);
    expect(state.sections.map((s) => s.state)).toEqual([SECTION_STOP, SECTION_FRESH | SECTION_START, SECTION_RESTART]);
  });

  it('ends the pass at an and, an or, a 0x3020, or a word it does not know', () => {
    // SCRANTIC 1048:1642 1048:1519
    for (const stray of [[ADS_OP.AND], [ADS_OP.OR], [ADS_OP.RANDOM_NOTHING, 5], [0x1234]]) {
      const state = load([[...stray, ...addScene(1)]]);
      expect(pass(state)).toBeNull();
      expect(node(state, 1).playCount).toBe(0);
    }
  });

  it('resumes a section at its start, or just past a 0x0005 word, which runs as nothing', () => {
    // SCRANTIC 1048:0c30 1048:1558
    const plain = load([[...addScene(1)]]);
    expect(sectionResumePoint(plain, plain.sections[0]!.start)).toBe(2);
    const marked = load([[...addScene(1), ADS_OP.MARKER_5, ...addScene(2)]]);
    expect(sectionResumePoint(marked, marked.sections[0]!.start)).toBe(14);
    pass(marked);
    expect(plays(marked)).toEqual([1, 1, 0]);
  });
});
```

Notes on the expected values, so a failure can be read quickly:

- `load` builds sections tagged 1, 2, 3, ... ; the first section starts at byte 2. Node `(1, t)` has tag page `t - 1`.
- The random block weights are 3, 1, 6 (word `+8` of each `0x2005`, word `+2` of `0x3020`); the pick is `random % 10 + 1`: 0 → first, 3 → second, 4 → `0x3020`, `0xfffd` (65533 % 10 = 3) → second.
- The `0x1380`..`0x13c1` expectations assume step 1 confirmed: `0x1380`/`0x1390` signed, `0x13a0`..`0x13c1` unsigned, all against 0. If `ads.md` says otherwise, fix this test and `storyValueHolds` together.

Run: `pnpm exec vitest run src/ads/script.test.ts`
Expected: FAIL, cannot resolve `./script.js`.

- [ ] **Action 7: Write the script interpreter**

Create `src/ads/script.ts`:

```ts
import {
  findNode, MODE_DONE, MODE_HOLD, MODE_IDLE, MODE_ONCE, MODE_REPEAT, MODE_TIMED, nextInstruction, NO_SECTION,
  resetNode, SECTION_FRESH, SECTION_RESTART, SECTION_START, SECTION_STOP, sectionIndex, word, type AdsState,
} from './state.js';

export const ADS_OP = {
  MARKER_1: 0x0001,
  MARKER_5: 0x0005,
  WHILE_COUNT: 0x1080,
  AND: 0x1420,
  OR: 0x1430,
  ELSE: 0x1500,
  END_IF: 0x1510,
  END_WHILE: 0x1520,
  RESTART_SCENE: 0x2000,
  ADD_SCENE: 0x2005,
  STOP_SCENE: 0x2010,
  HOLD_SCENE: 0x2015,
  RESET_SCENE: 0x2020,
  RANDOM: 0x3010,
  RANDOM_NOTHING: 0x3020,
  RANDOM_END: 0x30ff,
  DRAW_LAST: 0x4000,
  DRAW_FIRST: 0x4010,
  STOP_THIS_SECTION: 0xf000,
  STOP_SECTION: 0xf010,
  START_SECTION: 0xf200,
  RESTART_SECTION: 0xf210,
  END: 0xffff,
} as const;

const IF_OPCODES: ReadonlySet<number> = new Set([
  0x1310, 0x1320, 0x1330, 0x1340, 0x1350, 0x1360, 0x1370, 0x1380, 0x1390, 0x13a0, 0x13a1, 0x13b0, 0x13b1, 0x13c0, 0x13c1,
]);
const WHILE_OPCODES: ReadonlySet<number> = new Set([0x1010, 0x1020, 0x1030, 0x1040, 0x1050, 0x1060, 0x1070, 0x1080]);
const STORY_VALUE_OPCODES_FROM = 0x1380;
const THIS_SECTION = 0xffff;

const int16 = (value: number) => (value << 16) >> 16;

export function runBlock(state: AdsState, from: number | null): number | null {
  let at = from;
  while (at !== null) {
    if (word(state, at) === ADS_OP.END) return null;
    at = runInstruction(state, at);
    if (state.endBlock !== 0) {
      state.endBlock = 0;
      return at;
    }
  }
  return null;
}

export function runInstruction(state: AdsState, at: number): number | null {
  const op = word(state, at);
  const arg = (index: number) => word(state, at + 2 + 2 * index);
  if (IF_OPCODES.has(op)) return ifBlock(state, at);
  if (WHILE_OPCODES.has(op)) return whileBlock(state, at);
  switch (op) {
    case ADS_OP.MARKER_1:
    case ADS_OP.MARKER_5:
      return at + 2;
    case ADS_OP.ELSE: {
      const end = skipBlock(state, at + 2);
      state.endBlock++;
      return end;
    }
    case ADS_OP.END_IF:
      state.endBlock++;
      return at;
    case ADS_OP.END_WHILE:
      state.endBlock++;
      return null;
    case ADS_OP.RESTART_SCENE:
      restartScene(state, arg(0), arg(1), arg(2));
      return at + 10;
    case ADS_OP.ADD_SCENE:
      addScene(state, arg(0), arg(1), arg(2));
      return at + 10;
    case ADS_OP.STOP_SCENE:
      setMode(state, arg(0), arg(1), MODE_IDLE);
      return at + 8;
    case ADS_OP.HOLD_SCENE:
      setMode(state, arg(0), arg(1), MODE_HOLD);
      return at + 8;
    case ADS_OP.RESET_SCENE: {
      const node = findNode(state, arg(0), arg(1));
      if (node) resetNode(node);
      return at + 8;
    }
    case ADS_OP.DRAW_LAST:
      moveNode(state, arg(0), arg(1), 'last');
      return at + 8;
    case ADS_OP.DRAW_FIRST:
      moveNode(state, arg(0), arg(1), 'first');
      return at + 8;
    case ADS_OP.RANDOM:
      return randomBlock(state, at + 2);
    case ADS_OP.STOP_THIS_SECTION:
      if (state.current !== NO_SECTION) state.sections[state.current]!.state = SECTION_STOP;
      return null;
    case ADS_OP.STOP_SECTION: {
      const index = arg(0) === THIS_SECTION ? state.current : sectionIndex(state, arg(0));
      if (index !== NO_SECTION) state.sections[index]!.state = SECTION_STOP;
      return index === state.current ? null : at + 4;
    }
    case ADS_OP.START_SECTION:
      startSection(state, arg(0), SECTION_START);
      return at + 4;
    case ADS_OP.RESTART_SECTION:
      startSection(state, arg(0), SECTION_RESTART);
      return at + 4;
    default:
      return null;
  }
}

export function sectionResumePoint(state: AdsState, start: number): number {
  for (let at: number | null = start; at !== null && word(state, at) !== ADS_OP.END; at = nextInstruction(state, at)) {
    if (word(state, at) === ADS_OP.MARKER_5) return at + 2;
  }
  return start;
}

function ifBlock(state: AdsState, at: number): number | null {
  const body = evalConditions(state, at);
  if (body === null) return null;
  const end = state.conditionTrue ? runBlock(state, body) : skipFalseBlock(state, body);
  return end === null ? null : end + 2;
}

function whileBlock(state: AdsState, at: number): number | null {
  const body = evalConditions(state, at);
  const section = state.sections[state.current]!;
  if (state.conditionTrue) {
    section.counter++;
    section.resume = at;
    runBlock(state, body);
    return null;
  }
  section.counter = 0;
  section.resume = null;
  const end = whileEnd(state, body);
  return end === null ? null : end + 2;
}

function whileEnd(state: AdsState, from: number | null): number | null {
  let at = from;
  while (at !== null && word(state, at) !== 0) {
    const op = word(state, at);
    if (op === ADS_OP.END) return null;
    if (op === ADS_OP.END_WHILE) return at;
    at = nextInstruction(state, at);
  }
  return null;
}

function skipBlock(state: AdsState, from: number | null): number | null {
  let at = from;
  while (at !== null && word(state, at) !== 0) {
    const op = word(state, at);
    if (op === ADS_OP.ELSE || op === ADS_OP.END_IF) return at;
    if (op === ADS_OP.END) return null;
    if (IF_OPCODES.has(op)) {
      at = skipBlock(state, evalConditions(state, at));
      if (at !== null && word(state, at) === ADS_OP.ELSE) at = skipBlock(state, at + 2);
    }
    at = nextInstruction(state, at);
  }
  return null;
}

function skipFalseBlock(state: AdsState, from: number): number | null {
  const end = skipBlock(state, from);
  if (end !== null && word(state, end) === ADS_OP.ELSE) return runBlock(state, end + 2);
  return end;
}

function evalConditions(state: AdsState, from: number): number | null {
  let at = from;
  let holds = false;
  let someOrHeld = false;
  let evaluate = true;
  for (;;) {
    if (evaluate && conditionHolds(state, at)) holds = true;
    const joinerAt = nextInstruction(state, at);
    if (joinerAt === null) return null;
    const joiner = word(state, joinerAt);
    if (joiner !== ADS_OP.AND && joiner !== ADS_OP.OR) {
      state.conditionTrue = holds || someOrHeld;
      return joinerAt;
    }
    const nextAt = nextInstruction(state, joinerAt);
    if (nextAt === null) return null;
    at = nextAt;
    if (!holds) {
      evaluate = joiner === ADS_OP.OR;
    } else if (joiner === ADS_OP.OR) {
      someOrHeld = true;
      evaluate = false;
    } else {
      holds = false;
      evaluate = true;
    }
  }
}

function conditionHolds(state: AdsState, at: number): boolean {
  const op = word(state, at);
  const arg0 = word(state, at + 2);
  if (!IF_OPCODES.has(op) && !WHILE_OPCODES.has(op)) return false;
  if (op === ADS_OP.WHILE_COUNT) return int16(arg0) >= state.sections[state.current]!.counter;
  if (op >= STORY_VALUE_OPCODES_FROM) return storyValueHolds(op, arg0);
  const node = findNode(state, arg0, word(state, at + 4));
  const mode = node?.mode;
  switch (op & 0xff) {
    case 0x10: return mode === MODE_HOLD;
    case 0x20: return mode !== MODE_HOLD;
    case 0x30: return node === null || node.playCount === 0;
    case 0x40: return node !== null && node.playCount !== 0;
    case 0x50: return mode === MODE_DONE;
    case 0x60: return node === null || mode === MODE_IDLE || mode === MODE_DONE;
    default: return mode === MODE_ONCE || mode === MODE_REPEAT || mode === MODE_TIMED;
  }
}

// 1068:463a, 4636 and 4638 are never written, so these compare against 0.
function storyValueHolds(op: number, value: number): boolean {
  switch (op) {
    case 0x1380: return int16(value) >= 0;
    case 0x1390: return int16(value) <= 0;
    case 0x13a0:
    case 0x13a1: return true;
    default: return value === 0;
  }
}

function addScene(state: AdsState, ttmId: number, tag: number, count: number): void {
  const node = findNode(state, ttmId, tag);
  if (!node) return;
  const plays = int16(count);
  if (plays === 0) {
    node.mode = MODE_ONCE;
  } else if (plays < 0) {
    node.mode = MODE_TIMED;
    node.endTime = (state.now - plays) >>> 0;
  } else {
    node.mode = MODE_REPEAT;
    node.playsLeft = plays - 1;
  }
  node.playCount++;
}

function restartScene(state: AdsState, ttmId: number, tag: number, count: number): void {
  const node = findNode(state, ttmId, tag);
  if (!node) return;
  node.page = node.tagPage;
  addScene(state, ttmId, tag, count);
}

function setMode(state: AdsState, ttmId: number, tag: number, mode: number): void {
  const node = findNode(state, ttmId, tag);
  if (node) node.mode = mode;
}

function moveNode(state: AdsState, ttmId: number, tag: number, to: 'first' | 'last'): void {
  const node = findNode(state, ttmId, tag);
  if (!node) return;
  const index = state.nodes.indexOf(node);
  if (index === (to === 'first' ? 0 : state.nodes.length - 1)) return;
  state.nodes.splice(index, 1);
  if (to === 'first') state.nodes.unshift(node);
  else state.nodes.push(node);
}

function randomBlock(state: AdsState, first: number): number | null {
  let total = 0;
  let at: number | null = first;
  while (at !== null && word(state, at) !== ADS_OP.RANDOM_END) {
    total = (total + randomWeight(state, at)) & 0xffff;
    at = nextInstruction(state, at);
  }
  if (at === null) return null;
  const after = at + 2;
  if (total === 0) return after;
  let left = Math.abs(int16((state.random() & 0xffff) % total)) + 1;
  let pick: number | null = first;
  while (pick !== null) {
    left -= randomWeight(state, pick);
    if (left < 1) break;
    pick = nextInstruction(state, pick);
  }
  if (pick !== null && word(state, pick) !== ADS_OP.RANDOM_NOTHING) runInstruction(state, pick);
  return after;
}

function randomWeight(state: AdsState, at: number): number {
  const op = word(state, at);
  if (op === ADS_OP.RESTART_SCENE || op === ADS_OP.ADD_SCENE) return word(state, at + 8);
  if (op === ADS_OP.RANDOM_NOTHING) return word(state, at + 2);
  return word(state, at + 6);
}

function startSection(state: AdsState, tag: number, how: number): void {
  const index = sectionIndex(state, tag);
  if (index === NO_SECTION) return;
  const section = state.sections[index]!;
  section.state = (section.state & SECTION_FRESH) | how;
}
```

The `// 1068:463a ...` comment stays: without it the constant answers look like a bug.

- [ ] **Action 8: Run the script tests**

Run: `pnpm exec vitest run src/ads/script.test.ts src/ads/state.test.ts`
Expected: all PASS. When one fails, check the test's expectation against `docs/re/ads.md` first, then the code.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 9: Commit**

```bash
git add src/ads/script.ts src/ads/script.test.ts
git commit -m "feat(ads): port the original ADS script interpreter"
```

## Part C: Docs

- [ ] **Action 10: Log the null guards**

Append to `docs/re/open-questions.md`, in the `Not reviewed on purpose` section (after OQ-27):

```markdown
### OQ-31: ADS interpreter guards where the original reads through a null pointer

- **Where:** `src/ads/script.ts` (`ifBlock`, `whileBlock`, `randomBlock`, `skipBlock`)
- **What it does:** when a condition chain, a block, or a random block runs off the end of the bytecode, ours stops the pass (returns `null`). After a false while block whose `0x1520` is missing, ours also stops.
- **Original:** `1048:1758` and `1048:11db` pass a null pointer on to `1048:1925`, which reads the word at it; `1048:17a0` adds 2 to a null result of `1048:118a` and goes on at offset 2 of segment 0; `1048:0cda` reads the word at a null pick.
- **Data:** every if and while block in the 10 ADS scripts is closed and every random block ends with `0x30FF` (the corpus trace of step 2 runs every section without reaching these paths).
- **Why not reviewed:** the original reads unrelated memory there; no port can match it.
- **Status:** open, by choice
```

If step 2's `Emulated` notes show a section that does reach one of these paths, say so in the entry instead of the `Data` line above.

- [ ] **Action 11: Update the checklist rows**

In `docs/re/ads.md`, `Side-by-side checklist`, replace the rows of the functions this step ported with `src/ads/<file>.ts:<line>` and the function name, status `fixed`:

| Original | Ours |
| --- | --- |
| `1048:0079` | `src/ads/state.ts` `makeAdsState` (all-or-nothing TTM load) |
| `1048:040f` | `src/ads/state.ts` `sectionScenes` |
| `1048:0b3e` | `src/ads/state.ts` `resetNode` |
| `1048:0bc5` | `src/ads/state.ts` `makeAdsState` (`nodes.forEach(resetNode)`) |
| `1048:0bf4` | `src/ads/state.ts` `findNode` |
| `1048:19e7` | `src/ads/state.ts` `sectionIndex` |
| `1048:0c30` | `src/ads/script.ts` `sectionResumePoint` |
| `1048:0c8d` | `src/ads/script.ts` `randomWeight` |
| `1048:0cda` | `src/ads/script.ts` `randomBlock` |
| `1048:0db6` | `src/ads/script.ts` `addScene` |
| `1048:0e2e` | `src/ads/script.ts` `restartScene` |
| `1048:0e6e`, `1048:0e9b` | `src/ads/script.ts` `setMode` |
| `1048:0ec8` | `src/ads/script.ts` `runInstruction` (`RESET_SCENE`) |
| `1048:0ef2`, `1048:0f8c` | `src/ads/script.ts` `moveNode` |
| `1048:106b` | `src/ads/script.ts` `skipBlock` |
| `1048:118a` | `src/ads/script.ts` `whileEnd` |
| `1048:11db` | `src/ads/script.ts` `skipFalseBlock` |
| `1048:1223` | `src/ads/script.ts` `evalConditions`, `conditionHolds`, `storyValueHolds` |
| `1048:1519` | `src/ads/script.ts` `runInstruction`, `ifBlock`, `whileBlock`, `startSection` |
| `1048:1925` | `src/ads/script.ts` `runBlock` |

Get each line number with `rg -n "function <name>" src/ads/state.ts src/ads/script.ts`. `1048:0303` stays at `src/decode/ads-bytecode.ts` and gains `src/ads/state.ts` `nextInstruction` (status `fixed`).

- [ ] **Action 12: Commit**

```bash
git add docs/re/ads.md docs/re/open-questions.md
git commit -m "docs(re): ADS script functions mapped to the port"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
