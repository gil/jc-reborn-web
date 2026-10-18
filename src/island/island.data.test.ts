import { describe, expect, it } from 'vitest';
import { COPY_RECT } from '../gfx/gdi/dirty.js';
import { Display, SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { hasCorpus, loadArchive } from '../testing/corpus.js';
import { islandAnimate, islandInit, islandRedrawHoliday, showBackground, type IslandState } from './island.js';

const STATE: IslandState = { lowTide: true, night: false, raft: 3, holiday: 3, xPos: -50, yPos: 20 };

function shownIsland() {
  const display = new Display();
  display.screenIsB = true;
  const rt = islandInit(display, loadArchive(), STATE);
  return { display, rt };
}

describe.skipIf(!hasCorpus)('island on the display', () => {
  it('draws the island into C and shows it through B on the window', () => {
    // SCRANTIC 1060:03d3 1038:06ce
    const { display } = shownIsland();
    expect(display.surfaces[SURFACE_B]!.pixels.every((index) => index === 0)).toBe(true);
    expect(display.surfaces[SURFACE_C]!.pixels.some((index) => index !== 0)).toBe(true);
    showBackground(display);
    display.restorePass(0);
    expect(display.window.pixels).toEqual(display.surfaces[SURFACE_C]!.pixels);
  });

  it('draws waves on B, presents them, and keeps them in C', () => {
    // SCRANTIC 1010:040e 1060:03d3
    const { display, rt } = shownIsland();
    showBackground(display);
    display.restorePass(0);
    const before = display.surfaces[SURFACE_C]!.pixels.slice();
    for (let i = 0; i < 12; i++) {
      islandAnimate(rt, display);
      display.restorePass(0);
    }
    expect(display.surfaces[SURFACE_C]!.pixels).not.toEqual(before);
    expect(display.surfaces[SURFACE_B]!.pixels).toEqual(display.surfaces[SURFACE_C]!.pixels);
    expect(display.window.pixels).toEqual(display.surfaces[SURFACE_C]!.pixels);
  });

  it('redraws the holiday sprite on B only when a presented rect overlaps it', () => {
    // SCRANTIC 1010:1e50 1060:04b2
    const { display, rt } = shownIsland();
    const holiday = rt.holiday!;
    const b = display.surfaces[SURFACE_B]!;
    islandRedrawHoliday(rt, display);
    expect(b.pixels.every((index) => index === 0)).toBe(true);
    display.dirty.add(holiday.x, holiday.y, 8, 8, COPY_RECT, SURFACE_B, SURFACE_A, 0, null);
    islandRedrawHoliday(rt, display);
    expect(b.pixels.some((index) => index !== 0)).toBe(true);
  });
});
