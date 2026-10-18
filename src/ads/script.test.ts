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
