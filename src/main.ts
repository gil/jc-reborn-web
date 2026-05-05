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
import { islandInit, islandInitHoliday, randomIslandState } from './island/island.js';
import { SCREEN_W, SCREEN_H } from './types.js';
import type { TtmContext } from './ttm/interpreter.js';
import { storyInit, storyTick, storyAnimateBg, type GameState } from './story/story.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const { map: mapBuf, archive: arcBuf } = await fetchData();
const map = parseMap(mapBuf);
const archive = indexArchive(map, arcBuf);

const palResRaw = archive.list.find(r => r.type === '.PAL')!;
const pal = makePalette();
setPaletteFromVga(pal, decodePal(palResRaw.payload).vga);

const islandState = randomIslandState();
const islandRt = islandInit(archive, islandState);
const holidayLayer = islandInitHoliday(archive, islandState);

const adsRaw = archive.list.find(r => r.type === '.ADS')!;
const adsInitial = decodeAds(adsRaw.payload);
const adsState = makeAdsState(adsInitial, archive, 1);

const ttmCtx: TtmContext = {
  archive,
  palette: pal,
  setBackground: (indexed) => { game.background = indexed; },
  playSample: (n) => console.log('playSample', n),
  dx: 0,
  dy: 0,
};

const game: GameState = {
  adsState,
  islandRt,
  islandState,
  holidayLayer,
  bgAnimTimer: 8,
  background: islandRt.bgLayer.indexed,
  ttmCtx,
  archive,
};

const storyState = storyInit(archive, game);

const img = ctx.createImageData(SCREEN_W, SCREEN_H);

startLoop(
  () => {
    const elapsed = pumpTicks();
    if (elapsed <= 0) return;
    storyAnimateBg(storyState, game, elapsed);
    storyTick(storyState, game);
    adsTick(game.adsState, elapsed, game.ttmCtx);
  },
  () => {
    composite(img, {
      background: game.background,
      ttmThreads: adsThreadLayers(game.adsState),
      holiday: game.holidayLayer,
      palette: pal,
    });
    ctx.putImageData(img, 0, 0);
  },
);
