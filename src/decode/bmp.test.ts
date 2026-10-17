import { describe, expect, it } from 'vitest';
import { chunk, concat, storedBody, words } from '../testing/build-chunks.js';
import { decodeBmp } from './bmp.js';

const PIXELS = Uint8Array.of(0x12, 0x34, 0x56, 0x78, 0x9a);

function bmpPayload(widths: number[], heights: number[], packed: Uint8Array, extra: Uint8Array[] = []): Uint8Array {
  const info = chunk('INF:', words(widths.length, ...widths, ...heights));
  return chunk('BMP:', concat(info, chunk('BIN:', storedBody(packed)), ...extra), true);
}

describe('decodeBmp', () => {
  // SCRANTIC 1030:1112 1030:124a 1030:000e
  it('reads every width, then every height, and cuts one pixel buffer image by image', () => {
    const { sprites } = decodeBmp(bmpPayload([2, 4], [1, 2], PIXELS));
    expect(sprites.map(({ width, height }) => [width, height])).toEqual([[2, 1], [4, 2]]);
    expect(Array.from(sprites[0]!.indexed)).toEqual([1, 2]);
    expect(Array.from(sprites[1]!.indexed)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // SCRANTIC 1030:124a 1068:1ebf
  it('ignores a BMP:VGA: layer, as the original does in 16-color mode', () => {
    const vga = chunk('VGA:', storedBody(new Uint8Array(PIXELS.length).fill(0xff)));
    const plain = decodeBmp(bmpPayload([2, 4], [1, 2], PIXELS)).sprites;
    expect(decodeBmp(bmpPayload([2, 4], [1, 2], PIXELS, [vga])).sprites).toEqual(plain);
  });

  // SCRANTIC 1040:0000
  it('refuses odd widths, where the original disagrees with itself on row length', () => {
    expect(() => decodeBmp(bmpPayload([3], [1], PIXELS))).toThrow(/odd width/);
  });

  it('refuses pixel data shorter than the images need', () => {
    expect(() => decodeBmp(bmpPayload([4], [4], PIXELS))).toThrow(/short/);
  });
});
