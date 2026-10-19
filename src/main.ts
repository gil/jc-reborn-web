import { fetchData } from './io/fetch-resources.js';
import { parseMap } from './resource/resource-map.js';
import { indexArchive } from './resource/resource-archive.js';
import { decodePal } from './decode/pal.js';
import { makePalette, setPaletteColors } from './gfx/palette.js';
import { Display } from './gfx/gdi/display.js';
import { makeDrawState } from './gfx/gdi/surface.js';
import { applyFade } from './gfx/fade.js';
import { presentSurface } from './gfx/present.js';
import { startLoop } from './engine/loop.js';
import { EngineClock } from './engine/clock.js';
import { clockTick, makeTimers } from './engine/timers.js';
import { DisplayIslandDevice } from './island/island-device.js';
import { drawIntro, drawIsland, makeIsland } from './island/island.js';
import { SCREEN_W, SCREEN_H } from './types.js';
import { GdiDevice } from './ttm/gdi-device.js';
import { makeTtmEnv } from './ttm/page-runner.js';
import { loadWalk, makeWalk } from './walk/walk.js';
import { seedRandom, StoryRandom } from './story/random.js';
import { ADS_FILES } from './story/scene-table.js';
import { makeStoryWorld } from './story/sequence.js';
import { loadSettings, localSettingsStore } from './story/settings.js';
import { currentEntry, makeStoryState, storyStep, type GameState } from './story/story.js';
import { initSound, playSample } from './audio/sound.js';
import { initSoundIcon } from './ui/sound-icon.js';
import { initFullscreen } from './ui/fullscreen.js';
import { initCrt } from './ui/crt.js';
import { initHud, hudUpdate } from './debug/hud.js';

const INTRO_HOLD_MS = 2000;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const controls = initSoundIcon(canvas);
initFullscreen(canvas, controls);
initCrt(canvas, controls);
initHud();
initSound(); // fire-and-forget: pre-fetches WAV bytes; AudioContext created on first icon click

const { map: mapBuf, archive: arcBuf } = await fetchData();
const archive = indexArchive(parseMap(mapBuf), arcBuf);

const pal = makePalette();
setPaletteColors(pal, decodePal(archive.list.find((r) => r.type === '.PAL')!.payload).colors);

const display = new Display();
display.screenIsB = true;
const draw = makeDrawState();
const random = new StoryRandom();
seedRandom(random, Math.floor(Date.now() / 1000));
const device = new GdiDevice(display, draw, archive, { playSound: playSample, random: () => random.next() });

const world = makeStoryWorld(random);
const timers = makeTimers();
const islandDevice = new DisplayIslandDevice(display, archive);
const island = makeIsland(islandDevice, world, timers, { background: true, clouds: true, waves: true });
const settings = localSettingsStore();
loadSettings(settings, world, island.settings);

const params = new URLSearchParams(location.search);
const skipIntro = params.get('skipIntro') === 'true';
if (!skipIntro) drawIntro(islandDevice);
drawIsland(island);
const walk = makeWalk(island);
loadWalk(walk);

const game: GameState = {
  archive, display, ttm: makeTtmEnv(device, draw), palette: pal, random, timers, world, island, walk, settings,
  fadeState: null,
  clock: () => new Date(),
};
const story = makeStoryState(params.get('ads'));

const img = ctx.createImageData(SCREEN_W, SCREEN_H);
const engineClock = new EngineClock(performance.now());
const firstStepAt = performance.now() + (skipIntro ? 0 : INTRO_HOLD_MS);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) engineClock.resume(performance.now());
});

startLoop(
  () => {
    const now = performance.now();
    for (let ticks = engineClock.ticksDue(now); ticks > 0; ticks--) clockTick(timers);
    if (!engineClock.stepDue(now) || now < firstStepAt) return;
    storyStep(story, game);
  },
  () => {
    presentSurface(img.data, display.window, pal);
    if (game.fadeState) applyFade(img.data, game.fadeState);
    ctx.putImageData(img, 0, 0);
    const entry = currentEntry(game);
    hudUpdate(entry ?(ADS_FILES.get(entry.ads) ?? 'idle') : '-');
  },
);
