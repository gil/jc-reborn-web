import { fetchData } from './io/fetch-resources.js';
import { parseMap } from './resource/resource-map.js';
import { indexArchive } from './resource/resource-archive.js';
import { decodePal } from './decode/pal.js';
import { decodeAds } from './decode/ads-loader.js';
import { makePalette, setPaletteColors } from './gfx/palette.js';
import { Display } from './gfx/gdi/display.js';
import { makeDrawState } from './gfx/gdi/surface.js';
import { applyFade } from './gfx/fade.js';
import { presentSurface } from './gfx/present.js';
import { makeAdsState } from './ads/state.js';
import { adsActiveNodeCount } from './ads/tick.js';
import { walkTick } from './walk/walk.js';
import { startLoop } from './engine/loop.js';
import { pumpMs, hasEnoughMs, consumeMs, msPerTick, resetClock } from './engine/clock.js';
import { randomIslandState } from './island/island.js';
import { SCREEN_W, SCREEN_H } from './types.js';
import { GdiDevice } from './ttm/gdi-device.js';
import { makeTtmEnv } from './ttm/page-runner.js';
import { storyInit, storyTick, storyAnimateBg, storyPlayScene, storyRedrawHoliday, type GameState } from './story/story.js';
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
setPaletteColors(pal, decodePal(palResRaw.payload).colors);

const display = new Display();
display.screenIsB = true;
const draw = makeDrawState();
const random = () => Math.floor(Math.random() * 0x10000);
const device = new GdiDevice(display, draw, archive, { playSound: playSample, random });

const adsRaw = archive.list.find(r => r.type === '.ADS')!;

const game: GameState = {
  adsState: makeAdsState(decodeAds(adsRaw.payload), archive, random),
  walk: null,
  random,
  islandRt: null,
  islandState: randomIslandState(),
  bgAnimTimer: 8,
  ttm: makeTtmEnv(device, draw),
  display,
  palette: pal,
  archive,
  fadeState: null,
};

const params = new URLSearchParams(location.search);
const debugAds = params.get('ads');
const skipIntro = params.get('skipIntro') === 'true';

const storyState = storyInit(archive, game, debugAds, skipIntro);

const img = ctx.createImageData(SCREEN_W, SCREEN_H);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resetClock();
});

let now = 0;

startLoop(
  () => {
    pumpMs();
    while (hasEnoughMs(msPerTick())) {
      consumeMs(msPerTick());
      now++;
      storyTick(storyState, game);
      storyAnimateBg(storyState, game, 1);
      if (game.walk) walkTick(game.walk, display);
      storyPlayScene(storyState, game, now);
      storyRedrawHoliday(game);
      display.restorePass(0);
    }
  },
  () => {
    presentSurface(img.data, display.window, pal);
    if (game.fadeState) applyFade(img.data, game.fadeState);
    ctx.putImageData(img, 0, 0);
    hudUpdate(adsActiveNodeCount(game.adsState), storyState.currentScene?.adsName ?? '-');
  },
);
