import { fetchData } from './io/fetch-resources.js';
import { parseMap } from './resource/resource-map.js';
import { indexArchive } from './resource/resource-archive.js';
import { decodePal } from './decode/pal.js';
import { decodeAds } from './decode/ads-loader.js';
import { makePalette, setPaletteFromVga } from './gfx/palette.js';
import { makeAdsState, adsTick, adsThreadLayers } from './ads/scheduler.js';
import { composite } from './gfx/compositor.js';
import { startLoop } from './engine/loop.js';
import { pumpTicks } from './engine/clock.js';
import { SCREEN_W, SCREEN_H } from './types.js';
import type { TtmContext } from './ttm/interpreter.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const { map: mapBuf, archive: arcBuf } = await fetchData();
const map = parseMap(mapBuf);
const archive = indexArchive(map, arcBuf);

const palResRaw = archive.list.find(r => r.type === '.PAL')!;
const pal = makePalette();
setPaletteFromVga(pal, decodePal(palResRaw.payload).vga);

let bgIndexed: Uint8Array | null = null;

const ttmCtx: TtmContext = {
  archive,
  palette: pal,
  setBackground: (idx) => { bgIndexed = idx; },
  playSample: (n) => console.log('playSample', n),
};

// Start with the first ADS resource at tag 1
const adsRaw = archive.list.find(r => r.type === '.ADS')!;
const ads = decodeAds(adsRaw.payload);
const adsState = makeAdsState(ads, archive, 1);

const img = ctx.createImageData(SCREEN_W, SCREEN_H);

startLoop(
  () => {
    const elapsed = pumpTicks();
    if (elapsed > 0) adsTick(adsState, elapsed, ttmCtx);
  },
  () => {
    composite(img, {
      background: bgIndexed,
      ttmThreads: adsThreadLayers(adsState),
      holiday: null,
      palette: pal,
    });
    ctx.putImageData(img, 0, 0);
  },
);
