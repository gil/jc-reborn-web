import { describe, expect, it } from 'vitest';
import { decodeScr } from '../../decode/scr.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../../testing/corpus.js';
import { NO_SOURCE } from './dirty.js';
import { Display, RESTORE_PAIRS, SINGLE_RESTORE_PAIRS, SURFACE_A, SURFACE_B, SURFACE_C } from './display.js';
import { rawIndices } from './surface.js';

const SURFACE_BY_HARNESS_VALUE = new Map([
  [-1, NO_SOURCE],
  [0xa1, SURFACE_A],
  [0xb2, SURFACE_B],
  [0xc3, SURFACE_C],
]);

describe.skipIf(!hasFixture('graphics/restore-table.tsv'))('restore table matches the original SCRANTIC.SCR', () => {
  it('replays the same surface pairs in the same order', () => {
    // SCRANTIC 1060:03d3 1068:287e 1068:2882
    const rows = readFixtureRows('graphics/restore-table.tsv');
    const pairs = (which: string) =>
      rows.filter(([w]) => w === which).map(([, source, target]) => [SURFACE_BY_HARNESS_VALUE.get(Number(source)), SURFACE_BY_HARNESS_VALUE.get(Number(target))]);
    expect(pairs('0')).toEqual(RESTORE_PAIRS);
    expect(pairs('1')).toEqual(SINGLE_RESTORE_PAIRS);
  });
});

describe.skipIf(!hasCorpus)('every SCR resource blitted by the model', () => {
  it('keeps index 0 opaque where the decoder marks it see-through', () => {
    // SCRANTIC 1040:0286
    const screens = loadArchive().list.filter((resource) => resource.type === '.SCR');
    const zeroPixels = Object.fromEntries(
      screens.map(({ name, payload }) => {
        const { width, height, indexed } = decodeScr(payload);
        const display = new Display();
        display.surfaces[SURFACE_A]!.pixels.fill(15);
        display.blitScreen({ width, height, pixels: rawIndices(indexed) }, 0, 0);
        const shown = display.surfaces[SURFACE_A]!.pixels.subarray(0, width * Math.min(height, 480));
        return [name, shown.filter((index) => index === 0).length];
      }),
    );
    expect(zeroPixels).toMatchSnapshot();
  });
});
