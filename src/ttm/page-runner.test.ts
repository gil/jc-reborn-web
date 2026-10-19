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
