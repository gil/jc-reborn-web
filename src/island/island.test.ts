import { describe, expect, it } from 'vitest';
import { makeTimers } from '../engine/timers.js';
import { SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { makeSurface, type ClipRect } from '../gfx/gdi/surface.js';
import { StoryRandom } from '../story/random.js';
import { makeStoryWorld, MODE_NO_ISLAND } from '../story/sequence.js';
import type { IslandDevice, SpriteSheet } from './island-device.js';
import { drawHoliday, drawIsland, makeIsland, rectOverlap, redrawIslandOver, ttmOffset } from './island.js';

class FakeDevice implements IslandDevice {
  readonly drawn: (string | number)[][] = [];
  clip: ClipRect | null = null;
  overlaps = false;
  private target = SURFACE_A;
  loadSheet(name: string): SpriteSheet {
    return { name, images: Array.from({ length: 42 }, () => makeSurface(10, 10)) };
  }
  loadScreen(name: string): void { this.drawn.push(['screen', this.target, name]); }
  setSource(): void {}
  setTarget(surface: number): void { this.target = surface; }
  fillRect(x: number, y: number, w: number, h: number, color: number): void { this.drawn.push(['fill', this.target, x, y, w, h, color]); }
  drawSprite(sheet: SpriteSheet, index: number, x: number, y: number, flags: number): void {
    this.drawn.push(['sprite', this.target, sheet.name, index, x, y, flags, this.clip ? 1 : 0]);
  }
  drawLine(): void {}
  copyRect(x: number, y: number, w: number, h: number): void { this.drawn.push(['copy', x, y, w, h]); }
  addDirtyRect(): void {}
  dirtyOverlaps(): boolean { return this.overlaps; }
  setClip(clip: ClipRect | null): void { this.clip = clip; }
}

function island() {
  const device = new FakeDevice();
  const world = makeStoryWorld(new StoryRandom());
  const isle = makeIsland(device, world, makeTimers(), { background: true, clouds: true, waves: true });
  expect(drawIsland(isle)).toBe(true);
  device.drawn.length = 0;
  return { device, world, isle };
}

describe('island', () => {
  it('only loads its bitmaps on the first call', () => {
    // SCRANTIC 1010:0136 1008:143c
    const device = new FakeDevice();
    const isle = makeIsland(device, makeStoryWorld(new StoryRandom()), makeTimers(), { background: true, clouds: true, waves: true });
    drawIsland(isle);
    expect(device.drawn).toEqual([]);
    expect(isle.background?.name).toBe('BACKGRND.BMP');
    expect(isle.raft?.name).toBe('MRAFT.BMP');
  });

  it('draws the island into C, then copies C to B', () => {
    // SCRANTIC 1010:0136
    const { device, isle } = island();
    drawIsland(isle);
    expect(device.drawn[0]![1]).toBe(SURFACE_C);
    expect(device.drawn).toContainEqual(['sprite', SURFACE_C, 'BACKGRND.BMP', 0, isle.x + 0x121, isle.y + 0x117, 0, 0]);
    expect(device.drawn).toContainEqual(['copy', 0, 0, 640, 480]);
  });

  it('fills the screen with color 5 and draws no island in no-island mode', () => {
    // SCRANTIC 1010:0136
    const { device, world, isle } = island();
    world.island.mode = MODE_NO_ISLAND;
    drawIsland(isle);
    expect(device.drawn[0]).toEqual(['fill', SURFACE_C, 0, 0, 640, 480, 5]);
    expect(device.drawn.filter((event) => event[0] === 'sprite' && event[3] === 0 && event[2] === 'BACKGRND.BMP')).toEqual([]);
  });

  it('places the island at fixed spots for the low and left places', () => {
    // SCRANTIC 1010:1b00
    const { world, isle } = island();
    world.island.place = 2;
    drawIsland(isle);
    expect([isle.x, isle.y]).toEqual([0, 299 - 0x117]);
    world.island.place = 1;
    drawIsland(isle);
    expect([isle.x, isle.y]).toEqual([0x11 - 0x121, 0x135 - 0x117]);
  });

  it('offsets TTM drawing by the island position plus one, or plus 0x111 for left scenes', () => {
    // SCRANTIC 1010:00fc
    const { world, isle } = island();
    isle.x = -20;
    isle.y = 7;
    expect(ttmOffset(isle, false)).toEqual({ x: -19, y: 7 });
    expect(ttmOffset(isle, true)).toEqual({ x: -20 + 0x111, y: 7 });
    world.island.mode = MODE_NO_ISLAND;
    expect(ttmOffset(isle, true)).toEqual({ x: 0, y: 0 });
  });

  it('redraws the holiday sprite only when a presented rect overlaps it', () => {
    // SCRANTIC 1010:1e50
    const { device, world, isle } = island();
    world.sequence.holiday = 1;
    drawIsland(isle);
    device.drawn.length = 0;
    drawHoliday(isle, false);
    expect(device.drawn).toEqual([]);
    device.overlaps = true;
    drawHoliday(isle, false);
    expect(device.drawn).toEqual([['sprite', SURFACE_B, 'HOLIDAY.BMP', 0, isle.x + 0x19b, isle.y + 0x12a, 0, 0]]);
  });

  it('redraws only the palm trunk over a walking Johnny, clipped to him', () => {
    // SCRANTIC 1010:1551
    const { device, isle } = island();
    drawIsland(isle);
    device.drawn.length = 0;
    redrawIslandOver(isle, makeSurface(20, 40), isle.x + 0x1bb, isle.y + 0x94, false);
    expect(device.drawn).toEqual([['sprite', SURFACE_B, 'BACKGRND.BMP', 13, isle.x + 0x1bb, isle.y + 0x94, 0, 1]]);
    expect(device.clip).toBeNull();
  });
});

describe('rect overlap', () => {
  it('is 2 inside, 1 touching, 0 apart', () => {
    // SCRANTIC 1010:1a88
    expect(rectOverlap(10, 10, 5, 5, 0, 0, 100, 100)).toBe(2);
    expect(rectOverlap(95, 10, 10, 5, 0, 0, 100, 100)).toBe(1);
    expect(rectOverlap(200, 10, 5, 5, 0, 0, 100, 100)).toBe(0);
  });
});
