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
import { islandInit, islandAnimate, islandInitHoliday, randomIslandState } from './island/island.js';
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

// Island background
const islandState = randomIslandState();
const islandRt = islandInit(archive, islandState);
const holidayLayer = islandInitHoliday(archive, islandState);
let bgAnimTimer = 8;

const ttmCtx: TtmContext = {
  archive,
  palette: pal,
  setBackground: () => {}, // island owns the background
  playSample: (n) => console.log('playSample', n),
};

// Start ADS
const adsRaw = archive.list.find(r => r.type === '.ADS')!;
const ads = decodeAds(adsRaw.payload);
const adsState = makeAdsState(ads, archive, 1);

const img = ctx.createImageData(SCREEN_W, SCREEN_H);

startLoop(
  () => {
    const elapsed = pumpTicks();
    if (elapsed <= 0) return;
    // Island wave animation thread (delay=8)
    bgAnimTimer -= elapsed;
    while (bgAnimTimer <= 0) { islandAnimate(islandRt); bgAnimTimer += 8; }
    // ADS scene threads
    adsTick(adsState, elapsed, ttmCtx);
  },
  () => {
    composite(img, {
      background: islandRt.bgLayer.indexed,
      ttmThreads: adsThreadLayers(adsState),
      holiday: holidayLayer,
      palette: pal,
    });
    ctx.putImageData(img, 0, 0);
  },
);
