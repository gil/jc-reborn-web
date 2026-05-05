import { fetchData } from './io/fetch-resources.js';
import { parseMap } from './resource/resource-map.js';
import { indexArchive } from './resource/resource-archive.js';
import { decodePal } from './decode/pal.js';
import { decodeScr } from './decode/scr.js';
import { decodeBmp } from './decode/bmp.js';
import { decodeTtm } from './decode/ttm-loader.js';
import { decodeAds } from './decode/ads-loader.js';
import { disasmTtm } from './decode/ttm-disasm.js';
import { makePalette, setPaletteFromVga } from './gfx/palette.js';
import { makeLayer } from './gfx/layer.js';
import { drawLine, drawRect, drawCircle } from './gfx/primitives.js';
import { drawSprite, drawSpriteFlip } from './gfx/sprite.js';
import { composite } from './gfx/compositor.js';
import { SCREEN_W, SCREEN_H } from './types.js';

const { map: mapBuf, archive: arcBuf } = await fetchData();
const map = parseMap(mapBuf);
const archive = indexArchive(map, arcBuf);

const palResRaw = archive.list.find(r => r.type === '.PAL')!;
const pal = makePalette();
setPaletteFromVga(pal, decodePal(palResRaw.payload).vga);

const picker = document.getElementById('picker') as HTMLSelectElement;
for (const r of archive.list) {
  const o = document.createElement('option');
  o.value = r.name; o.textContent = `${r.name} (${r.payload.length} B)`;
  picker.appendChild(o);
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const info = document.getElementById('info') as HTMLPreElement;

document.getElementById('play')!.addEventListener('click', () => render(picker.value));

function render(name: string): void {
  const res = archive.byName.get(name)!;
  info.textContent = `${name} type=${res.type} size=${res.payload.length}`;
  ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
  if (res.type === '.SCR') renderScr(res.payload);
  else if (res.type === '.BMP') renderBmpSheet(res.payload);
  else if (res.type === '.TTM') info.textContent += '\n\n' + disasmTtm(decodeTtm(res.payload).bytecode);
  else if (res.type === '.ADS') {
    const a = decodeAds(res.payload);
    info.textContent += `\nsubs=${a.subResources.map(s => s.slot + ':' + s.name).join(',')}\ntags=${a.tags.map(t => t.id + ':' + t.description).join(', ')}`;
  } else if (res.type === '.PAL') info.textContent += '\n(palette already loaded)';
}

function renderScr(payload: Uint8Array): void {
  const scr = decodeScr(payload);
  const img = ctx.createImageData(SCREEN_W, SCREEN_H);
  for (let y = 0; y < scr.height; y++) {
    for (let x = 0; x < scr.width; x++) {
      const idx = scr.indexed[y * scr.width + x]!;
      const o = (y * SCREEN_W + x) * 4;
      img.data[o + 0] = pal[idx * 4 + 0]!;
      img.data[o + 1] = pal[idx * 4 + 1]!;
      img.data[o + 2] = pal[idx * 4 + 2]!;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderBmpSheet(payload: Uint8Array): void {
  const bmp = decodeBmp(payload);
  const img = ctx.createImageData(SCREEN_W, SCREEN_H);
  let cx = 0, cy = 0, rowH = 0;
  for (const sp of bmp.sprites) {
    if (cx + sp.width > SCREEN_W) { cx = 0; cy += rowH; rowH = 0; }
    if (cy + sp.height > SCREEN_H) break;
    for (let y = 0; y < sp.height; y++) {
      for (let x = 0; x < sp.width; x++) {
        const idx = sp.indexed[y * sp.width + x]!;
        const o = ((cy + y) * SCREEN_W + (cx + x)) * 4;
        img.data[o + 0] = pal[idx * 4 + 0]!;
        img.data[o + 1] = pal[idx * 4 + 1]!;
        img.data[o + 2] = pal[idx * 4 + 2]!;
        img.data[o + 3] = 255;
      }
    }
    cx += sp.width + 2;
    rowH = Math.max(rowH, sp.height + 2);
  }
  ctx.putImageData(img, 0, 0);
}

const demoBtn = document.createElement('button');
demoBtn.textContent = 'Demo primitives';
document.querySelector('div')!.appendChild(demoBtn);
demoBtn.addEventListener('click', () => {
  const scr = archive.list.find(r => r.type === '.SCR')!;
  const bmp = archive.list.find(r => r.type === '.BMP')!;
  const bg = decodeScr(scr.payload).indexed;
  const sprites = decodeBmp(bmp.payload).sprites;
  const layer = makeLayer();
  drawLine(layer, 10, 10, 600, 200, 5);
  drawRect(layer, 50, 50, 100, 80, 8);
  drawCircle(layer, 200, 100, 80, 80, 12, 2);
  drawSprite(layer, sprites[0]!, 300, 200);
  drawSpriteFlip(layer, sprites[0]!, 400, 200);
  const img = ctx.createImageData(SCREEN_W, SCREEN_H);
  composite(img, { background: bg, ttmThreads: [layer], holiday: null, palette: pal });
  ctx.putImageData(img, 0, 0);
});
