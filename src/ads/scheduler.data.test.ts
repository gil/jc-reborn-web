import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { Display } from '../gfx/gdi/display.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { makePalette } from '../gfx/palette.js';
import { storyScenes } from '../story/story-data.js';
import { hasCorpus, loadArchive } from '../testing/corpus.js';
import { GdiDevice } from '../ttm/gdi-device.js';
import { makeTtmEnv } from '../ttm/page-runner.js';
import { adsTick, makeAdsState } from './scheduler.js';

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
});
