import { describe, expect, it } from 'vitest';
import { decodeBmp } from '../../decode/bmp.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureBytes, readFixtureRows } from '../../testing/corpus.js';
import { packNibbles } from '../../testing/nibbles.js';
import { TRANSPARENT, type Sprite } from '../../types.js';

const bitmaps = () => loadArchive().list.filter((resource) => resource.type === '.BMP');

const originalMaskStride = (width: number) => Math.floor((width + 8) / 16) * 2;
const gdiMonochromeStride = (width: number) => Math.floor((width + 15) / 16) * 2;

function expectedMask({ width, height, indexed }: Sprite): Uint8Array {
  const stride = originalMaskStride(width);
  const mask = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (indexed[y * width + x] !== TRANSPARENT) mask[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return mask;
}

function mirrored({ width, height, indexed }: Sprite): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = indexed[y * width + width - 1 - x]!;
  }
  return out;
}

describe.skipIf(!hasCorpus)('every BMP image', () => {
  it('has a width that is a multiple of 8, so the mask stride quirks never trigger', () => {
    // SCRANTIC 1040:035c
    const odd = bitmaps().flatMap(({ name, payload }) =>
      decodeBmp(payload).sprites.flatMap(({ width }, i) =>
        width % 8 === 0 && originalMaskStride(width) === gdiMonochromeStride(width) ? [] : [`${name}#${i} ${width}`],
      ),
    );
    expect(odd).toEqual([]);
  });
});

describe.skipIf(!hasFixture('graphics/masks.tsv'))('masks and mirrors match the original SCRANTIC.SCR', () => {
  it('sets a mask bit exactly where the index is not 0, and mirrors rows pixel by pixel', () => {
    // SCRANTIC 1040:035c 1040:054e
    const archive = loadArchive();
    const wrong = readFixtureRows('graphics/masks.tsv').flatMap(([name, , , masksFile, mirroredFile]) => {
      const { sprites } = decodeBmp(archive.byName.get(name!)!.payload);
      const masks = readFixtureBytes(`graphics/${masksFile}`);
      const mirrors = readFixtureBytes(`graphics/${mirroredFile}`);
      const errors: string[] = [];
      let maskAt = 0;
      let mirrorAt = 0;
      sprites.forEach((sprite, i) => {
        const mask = expectedMask(sprite);
        if (!masks.subarray(maskAt, maskAt + mask.length).every((byte, j) => byte === mask[j])) errors.push(`${name}#${i} mask`);
        maskAt += mask.length;
        const packed = packNibbles(mirrored(sprite));
        if (!mirrors.subarray(mirrorAt, mirrorAt + packed.length).every((byte, j) => byte === packed[j])) errors.push(`${name}#${i} mirror`);
        mirrorAt += packed.length;
      });
      if (maskAt !== masks.length || mirrorAt !== mirrors.length) errors.push(`${name}: sizes`);
      return errors;
    });
    expect(wrong).toEqual([]);
  });
});
