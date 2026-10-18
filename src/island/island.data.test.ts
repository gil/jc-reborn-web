import { describe, expect, it } from 'vitest';
import { Display, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { makeTimers } from '../engine/timers.js';
import { StoryRandom } from '../story/random.js';
import { makeStoryWorld } from '../story/sequence.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { ISLAND_CASES, traceIslandCase } from '../testing/island-recorder.js';
import { DisplayIslandDevice } from './island-device.js';
import { animateIsland, drawIsland, makeIsland } from './island.js';

describe.skipIf(!hasFixture('island/traces.tsv'))('island matches the original SCRANTIC.SCR', () => {
  it('draws and animates the same way in every case', { timeout: 120_000 }, () => {
    // SCRANTIC 1010:0136 1010:040e 1010:1e50 1010:0e74 1010:1d69 1010:0a38 1010:0b67 1010:04a2 1010:1551 1010:1b00 1010:14bf
    const archive = loadArchive();
    const original = new Map<number, string[]>();
    for (const [k, step, event, values] of readFixtureRows('island/traces.tsv')) {
      const key = Number(k);
      if (!original.has(key)) original.set(key, []);
      original.get(key)!.push([k, step, event, values ?? ''].join('\t'));
    }
    expect([...original.keys()]).toEqual(Array.from({ length: ISLAND_CASES }, (_, k) => k));
    const wrong: string[] = [];
    for (const [k, rows] of original) {
      const ours = traceIslandCase(archive, k);
      const at = ours.findIndex((row, i) => row !== rows[i]);
      if (at >= 0) wrong.push(`case ${k} row ${at}: ours ${ours[at]}; original ${rows[at] ?? '(end)'}`);
      else if (ours.length !== rows.length) wrong.push(`case ${k}: ours ${ours.length} rows, original ${rows.length}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe.skipIf(!hasCorpus)('island on the display', () => {
  it('draws the island into C, copies it to B, and presents it through the restore pass', () => {
    // SCRANTIC 1010:0136 1060:03d3
    const display = new Display();
    display.screenIsB = true;
    const island = makeIsland(new DisplayIslandDevice(display, loadArchive()), makeStoryWorld(new StoryRandom()), makeTimers(), { background: true, clouds: true, waves: true });
    drawIsland(island);
    drawIsland(island);
    expect(display.surfaces[SURFACE_C]!.pixels.some((index) => index !== 0)).toBe(true);
    display.restorePass(0);
    expect(display.surfaces[SURFACE_B]!.pixels).toEqual(display.surfaces[SURFACE_C]!.pixels);
    expect(display.window.pixels).toEqual(display.surfaces[SURFACE_B]!.pixels);
    const before = display.surfaces[SURFACE_B]!.pixels.slice();
    island.timers.surf = 0;
    animateIsland(island, false);
    expect(display.surfaces[SURFACE_B]!.pixels).not.toEqual(before);
  });
});
