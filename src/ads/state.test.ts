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
