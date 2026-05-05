import { SCREEN_W, SCREEN_H } from './types.js';
import { makePalette, setPaletteFromVga } from './gfx/palette.js';
import { makeLayer, fillRect } from './gfx/layer.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const img = ctx.createImageData(SCREEN_W, SCREEN_H);

const fakeVga = new Uint8Array(16 * 3);
for (let i = 0; i < 16; i++) {
  fakeVga[i * 3 + 0] = (i * 4) & 63;
  fakeVga[i * 3 + 1] = (i * 8) & 63;
  fakeVga[i * 3 + 2] = (i * 16) & 63;
}
const pal = makePalette();
setPaletteFromVga(pal, fakeVga);

const layer = makeLayer();
for (let i = 0; i < 16; i++) {
  fillRect(layer, { x: i * 40, y: 0, w: 40, h: 480 }, i);
}

for (let p = 0; p < SCREEN_W * SCREEN_H; p++) {
  const idx = layer.indexed[p]!;
  const o = p * 4;
  if (idx === 0xff) {
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
    img.data[o + 3] = 255;
  } else {
    img.data[o + 0] = pal[idx * 4 + 0]!;
    img.data[o + 1] = pal[idx * 4 + 1]!;
    img.data[o + 2] = pal[idx * 4 + 2]!;
    img.data[o + 3] = 255;
  }
}
ctx.putImageData(img, 0, 0);
