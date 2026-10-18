import { describe, expect, it } from 'vitest';
import { Display, SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { makeDrawState, makeSurface } from '../gfx/gdi/surface.js';
import type { ParsedArchive } from '../resource/types.js';
import { GdiDevice } from './gdi-device.js';

const emptyArchive: ParsedArchive = { byName: new Map(), list: [] };

function setup() {
  const display = new Display();
  const draw = makeDrawState();
  const sounds: number[] = [];
  const device = new GdiDevice(display, draw, emptyArchive, { playSound: (sample) => sounds.push(sample), random: () => 1234 });
  return { display, draw, device, sounds };
}

describe('GdiDevice', () => {
  it('draws on the target surface with the shared draw state', () => {
    // SCRANTIC 1058:040c 1040:0d54
    const { display, draw, device } = setup();
    device.setSurfaces(SURFACE_B, SURFACE_C);
    draw.foreground = 4;
    device.setPixel(3, 2, 4);
    device.drawLine(0, 10, 4, 10);
    expect(display.surfaces[SURFACE_C]!.pixels[2 * 640 + 3]).toBe(4);
    expect(display.surfaces[SURFACE_C]!.pixels[10 * 640 + 2]).toBe(4);
    expect([display.source, display.target]).toEqual([SURFACE_B, SURFACE_C]);
  });

  it('draws a sprite with the mirrored-copy flag of its list', () => {
    // SCRANTIC 1028:17d8
    const { display, device } = setup();
    const image = makeSurface(2, 2);
    image.pixels.set([1, 2, 3, 4]);
    device.setSurfaces(SURFACE_B, SURFACE_B);
    device.drawSprite(image, true, 0, 0, 3);
    expect([...display.surfaces[SURFACE_B]!.pixels.subarray(0, 2)]).toEqual([2, 1]);
  });

  it('adds kind-1 dirty rects cut to the clip when the clip is on', () => {
    // SCRANTIC 1050:0a85 1060:007e
    const { display, draw, device } = setup();
    draw.clipOn = true;
    draw.clip = { x1: 0, y1: 0, x2: 15, y2: 15 };
    device.addDirtyRect(0, 0, 64, 8, SURFACE_B, SURFACE_A, 0);
    expect(display.dirty.snapshot()[0]![1][0]).toMatchObject({ x: 0, y: 0, w: 2, h: 8, source: SURFACE_B, target: SURFACE_A, age: 0 });
    draw.clipOn = false;
    device.addDirtyRect(0, 100, 64, 8, SURFACE_C, SURFACE_B, 0);
    expect(display.dirty.snapshot()[1]![1][0]).toMatchObject({ x: 0, y: 100, w: 8, h: 8 });
    device.dropDirtyList(SURFACE_C, SURFACE_B, 0);
    expect(display.dirty.snapshot()).toHaveLength(1);
  });

  it('saves a zone from the source and restores it into the target', () => {
    // SCRANTIC 1030:01c4 1030:0250
    const { display, device } = setup();
    display.surfaces[SURFACE_B]!.pixels[0] = 9;
    device.setSurfaces(SURFACE_B, SURFACE_A);
    device.saveZone(12, 0, 0, 1, 1);
    device.setSurfaces(SURFACE_B, SURFACE_C);
    device.restoreZone(12, 5, 5, 1, 1);
    expect(display.surfaces[SURFACE_C]!.pixels[5 * 640 + 5]).toBe(9);
  });

  it('returns null for resources the archive does not have', () => {
    // SCRANTIC 1028:17fa 1040:09eb
    const { device } = setup();
    expect(device.loadBitmaps('NONE.BMP', false)).toBeNull();
    expect(device.walkBitmaps()).toBeNull();
    expect(device.loadPalette('NONE.PAL')).toBeNull();
    expect(() => device.loadScreen('NONE.SCR')).not.toThrow();
  });

  it('passes sounds and random numbers to its hooks', () => {
    // SCRANTIC 1058:0063 1018:1e60
    const { device, sounds } = setup();
    device.playSound(3);
    expect(sounds).toEqual([3]);
    expect(device.random()).toBe(1234);
  });
});
