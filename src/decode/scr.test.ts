import { describe, expect, it } from 'vitest';
import { chunk, concat, storedBody, words } from '../testing/build-chunks.js';
import { TRANSPARENT } from '../types.js';
import { decodeScr } from './scr.js';

function scrPayload(dim: Uint8Array | null, packed: Uint8Array): Uint8Array {
  const parts = dim ? [chunk('DIM:', dim)] : [];
  return chunk('SCR:', concat(...parts, chunk('BIN:', storedBody(packed))), true);
}

describe('decodeScr', () => {
  // SCRANTIC 1030:16d8 1040:035c
  it('reads the size from SCR:DIM: and unpacks two pixels per byte, high nibble first', () => {
    const scr = decodeScr(scrPayload(words(4, 1), Uint8Array.of(0x12, 0x30)));
    expect(scr).toMatchObject({ width: 4, height: 1 });
    expect(Array.from(scr.indexed)).toEqual([1, 2, 3, TRANSPARENT]);
  });

  // SCRANTIC 1030:16d8
  it('uses 320 x 400 when SCR:DIM: is missing', () => {
    const scr = decodeScr(scrPayload(null, new Uint8Array(160 * 400)));
    expect(scr).toMatchObject({ width: 320, height: 400 });
    expect(scr.indexed).toHaveLength(320 * 400);
  });

  it('refuses pixel data shorter than width x height', () => {
    expect(() => decodeScr(scrPayload(words(4, 2), Uint8Array.of(0x12)))).toThrow(/short/);
  });
});
