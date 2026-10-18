import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { Display, SURFACE_C } from '../gfx/gdi/display.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { makePalette } from '../gfx/palette.js';
import { storyScenes } from '../story/story-data.js';
import { hasCorpus, loadArchive } from '../testing/corpus.js';
import { GdiDevice } from '../ttm/gdi-device.js';
import { makeTtmEnv } from '../ttm/page-runner.js';
import { adsPlayWalk, adsTick, makeAdsState } from './scheduler.js';

const TICKS = 100;

describe.skipIf(!hasCorpus)('ADS scheduler adapter on the real data', () => {
  it('plays the first ticks of every story scene on the display, never pausing for 0 ticks', { timeout: 120_000 }, () => {
    // SCRANTIC 1048:1acb 1048:196e 1060:03d3
    const archive = loadArchive();
    for (const scene of storyScenes) {
      const display = new Display();
      display.screenIsB = true;
      const draw = makeDrawState();
      const device = new GdiDevice(display, draw, archive, { playSound: () => {}, random: () => 0x1234 });
      const env = makeTtmEnv(device, draw);
      const state = makeAdsState(decodeAds(archive.byName.get(scene.adsName)!.payload), archive, scene.adsTagNo);
      for (let tick = 0; tick < TICKS; tick++) {
        expect(adsTick(state, env, makePalette(), display), `${scene.adsName} ${scene.adsTagNo} tick ${tick}`).toBeGreaterThanOrEqual(1);
        display.restorePass(0);
      }
    }
  });

  it('keeps Johnny on screen through the rest that ends a walk', () => {
    const archive = loadArchive();
    const display = new Display();
    display.screenIsB = true;
    const draw = makeDrawState();
    const env = makeTtmEnv(new GdiDevice(display, draw, archive, { playSound: () => {}, random: () => 0 }), draw);
    const scene = storyScenes[0]!;
    const state = makeAdsState(decodeAds(archive.byName.get(scene.adsName)!.payload), archive, scene.adsTagNo);
    for (const t of state.threads) t.isRunning = 0;
    adsPlayWalk(state, archive, [], 0, 0, 0, 0, 0, 0);
    const shown = () => display.window.pixels.some((index, p) => index !== display.surfaces[SURFACE_C]!.pixels[p]);
    while (!state.walkCtx!.done) {
      adsTick(state, env, makePalette(), display);
      display.restorePass(0);
      expect(shown()).toBe(true);
    }
  });

  it('keeps redrawing a purged page until its delay is due', () => {
    // SCRANTIC 1048:1acb 1048:196e
    const archive = loadArchive();
    const display = new Display();
    display.screenIsB = true;
    const draw = makeDrawState();
    const env = makeTtmEnv(new GdiDevice(display, draw, archive, { playSound: () => {}, random: () => 0 }), draw);
    const state = makeAdsState(decodeAds(archive.byName.get('STAND.ADS')!.payload), archive, 11);
    adsPlayWalk(state, archive, [], 0, 0, 5, 0, 0, 0);
    state.walkCtx!.sprites = [];
    const shown = () => display.window.pixels.some((index, p) => index !== display.surfaces[SURFACE_C]!.pixels[p]);
    const ending = () => state.threads.some((t) => t.isRunning === 2);
    let endingTicks = 0;
    for (let tick = 0; tick < 2000 && state.threads.some((t) => t.isRunning); tick++) {
      const wasEnding = ending();
      adsTick(state, env, makePalette(), display);
      display.restorePass(0);
      if (wasEnding) {
        endingTicks++;
        expect(shown(), `tick ${tick}`).toBe(true);
      }
    }
    expect(endingTicks).toBeGreaterThan(0);
  });
});
