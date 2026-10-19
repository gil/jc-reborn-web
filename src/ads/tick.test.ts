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
