import { fetchData } from './io/fetch-resources.js';
import { parseMap } from './resource/resource-map.js';
import { indexArchive } from './resource/resource-archive.js';
import { decodePal } from './decode/pal.js';
import { decodeAds } from './decode/ads-loader.js';
import { makePalette, setPaletteFromVga } from './gfx/palette.js';
import { makeAdsState, adsTick, adsThreadLayers, adsActiveThreadCount } from './ads/scheduler.js';
import { composite } from './gfx/compositor.js';
import { startLoop } from './engine/loop.js';
import { pumpMs, hasEnoughMs, consumeMs, msPerTick, resetClock } from './engine/clock.js';
import { islandInit, islandInitHoliday, randomIslandState } from './island/island.js';
import { SCREEN_W, SCREEN_H } from './types.js';
import type { TtmContext } from './ttm/interpreter.js';
import { storyInit, storyTick, storyAnimateBg, type GameState } from './story/story.js';
import { initSound, playSample } from './audio/sound.js';
import { initSoundIcon } from './ui/sound-icon.js';
import { initFullscreen } from './ui/fullscreen.js';
import { initCrt } from './ui/crt.js';
import { initHud, hudUpdate } from './debug/hud.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const controls = initSoundIcon(canvas);
initFullscreen(canvas, controls);
initCrt(canvas, controls);
initHud();
initSound(); // fire-and-forget: pre-fetches WAV bytes; AudioContext created on first icon click

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
  playSample,
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
  fadeState: null,
};

const debugAds = new URLSearchParams(location.search).get('ads');

const storyState = storyInit(archive, game, debugAds);

const img = ctx.createImageData(SCREEN_W, SCREEN_H);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resetClock();
});

let pacedMini = 4; // initial guess before first tick

startLoop(
  () => {
    pumpMs();

    // Advance the engine one mini-step for every mini * 20ms of accumulated
    // wall-clock time.  Matches the DOS game loop: adsPlay() → delay(mini*20).
    // rAF may call us more often than the engine needs; the accumulation gates
    // the actual tick rate so animations don't run too fast.
    while (hasEnoughMs(pacedMini * msPerTick())) {
      consumeMs(pacedMini * msPerTick());
      pacedMini = adsTick(game.adsState, game.ttmCtx);
      storyAnimateBg(storyState, game, pacedMini);
      storyTick(storyState, game);
    }
  },
  () => {
    composite(img, {
      background: game.background,
      ttmThreads: adsThreadLayers(game.adsState),
      holiday: game.holidayLayer,
      palette: pal,
      fade: game.fadeState,
    });
    ctx.putImageData(img, 0, 0);
    hudUpdate(adsActiveThreadCount(game.adsState), storyState.currentScene?.adsName ?? '-');
  },
);
