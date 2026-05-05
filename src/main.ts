import { fetchData } from './io/fetch-resources.js';
import { parseMap } from './resource/resource-map.js';
import { indexArchive } from './resource/resource-archive.js';
import { decodePal } from './decode/pal.js';
import { decodeTtm } from './decode/ttm-loader.js';
import { makePalette, setPaletteFromVga } from './gfx/palette.js';
import { makeThread } from './ttm/thread.js';
import { ttmPlay, ttmStartScene, type TtmContext } from './ttm/interpreter.js';
import { composite } from './gfx/compositor.js';
import { startLoop } from './engine/loop.js';
import { pumpTicks } from './engine/clock.js';
import { SCREEN_W, SCREEN_H } from './types.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const { map: mapBuf, archive: arcBuf } = await fetchData();
const map = parseMap(mapBuf);
const archive = indexArchive(map, arcBuf);

const palResRaw = archive.list.find(r => r.type === '.PAL')!;
const pal = makePalette();
setPaletteFromVga(pal, decodePal(palResRaw.payload).vga);

let bgIndexed: Uint8Array | null = null;

// Play the first available TTM at tag 1 as a smoke test
const ttmRes = archive.list.find(r => r.type === '.TTM')!;
const t = makeThread();
t.slot.ttm = decodeTtm(ttmRes.payload);

const ttmCtx: TtmContext = {
  archive,
  palette: pal,
  setBackground: (idx) => { bgIndexed = idx; },
  playSample: (n) => console.log('playSample', n),
};

try {
  ttmStartScene(t, 1);
} catch {
  // tag 1 may not exist in all TTMs
  t.isRunning = 2;
}

const img = ctx.createImageData(SCREEN_W, SCREEN_H);

startLoop(
  () => {
    const elapsed = pumpTicks();
    if (t.isRunning !== 1) return;
    if (t.timer > elapsed) { t.timer -= elapsed; return; }
    t.timer = t.delay;
    ttmPlay(t, ttmCtx);
  },
  () => {
    composite(img, { background: bgIndexed, ttmThreads: [t.layer], holiday: null, palette: pal });
    ctx.putImageData(img, 0, 0);
  },
);
