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
