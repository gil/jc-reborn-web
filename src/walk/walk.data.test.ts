import { describe, expect, it } from 'vitest';
import { makeTimers } from '../engine/timers.js';
import { Display, SURFACE_C } from '../gfx/gdi/display.js';
import { DisplayIslandDevice } from '../island/island-device.js';
import { animateIsland, drawIsland, makeIsland } from '../island/island.js';
import { StoryRandom } from '../story/random.js';
import { makeStoryWorld } from '../story/sequence.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { traceWalkCase, WALK_CASES } from '../testing/walk-recorder.js';
import { loadWalk, makeWalk, walkStep } from './walk.js';

describe.skipIf(!hasFixture('walk/traces.tsv'))('walk matches the original SCRANTIC.SCR', () => {
  it('picks, turns, moves, and draws the same way in every case', { timeout: 120_000 }, () => {
    // SCRANTIC 1018:0000 1018:0074 1018:0094 1018:03ac 1018:03ea 1018:0b46 1010:1551 1008:16c2
    const archive = loadArchive();
    const original = new Map<number, string[]>();
    for (const [k, beat, event, values] of readFixtureRows('walk/traces.tsv')) {
      const key = Number(k);
      if (!original.has(key)) original.set(key, []);
      original.get(key)!.push([k, beat, event, values ?? ''].join('\t'));
    }
    expect([...original.keys()]).toEqual(Array.from({ length: WALK_CASES }, (_, k) => k));
    const wrong: string[] = [];
    for (const [k, rows] of original) {
      const ours = traceWalkCase(archive, k);
      const at = ours.findIndex((row, i) => row !== rows[i]);
      if (at >= 0) wrong.push(`case ${k} row ${at}: ours ${ours[at]}; original ${rows[at] ?? '(end)'}`);
      else if (ours.length !== rows.length) wrong.push(`case ${k}: ours ${ours.length} rows, original ${rows.length}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe.skipIf(!hasCorpus)('walk on the display', () => {
  it('draws Johnny on B over the island and presents him through the restore pass', () => {
    // SCRANTIC 1018:0094 1010:040e 1060:03d3
    const display = new Display();
    display.screenIsB = true;
    const world = makeStoryWorld(new StoryRandom());
    const island = makeIsland(new DisplayIslandDevice(display, loadArchive()), world, makeTimers(), { background: true, clouds: true, waves: true });
    drawIsland(island);
    drawIsland(island);
    display.restorePass(0);
    const walk = makeWalk(island);
    expect(loadWalk(walk)).toBe(true);
    walk.targetSpot = 2;
    animateIsland(island, false);
    walkStep(walk);
    display.restorePass(0);
    const c = display.surfaces[SURFACE_C]!.pixels;
    expect(display.window.pixels.some((index, p) => index !== c[p])).toBe(true);
  });
});
