import { describe, expect, it } from 'vitest';
import { chunk } from '../testing/build-chunks.js';
import { decodePal } from './pal.js';

function palPayload(levels: number[]): Uint8Array {
  return chunk('PAL:', chunk('VGA:', Uint8Array.from(levels)), true);
}

describe('decodePal', () => {
  // SCRANTIC 1040:09eb 1068:25b0
  it('reads 16 colors and maps every channel level through the level table', () => {
    const levels = Array.from({ length: 768 }, (_, i) => i % 64);
    const { colors } = decodePal(palPayload(levels));
    expect(colors).toHaveLength(48);
    expect(Array.from(colors.subarray(0, 4))).toEqual([0, 4, 8, 12]);
    expect(Array.from(colors.subarray(30, 33))).toEqual([120, 124, 128]);
  });

  // SCRANTIC 1068:25b0
  it('maps level 63 to 255 and level 62 to 248', () => {
    const levels = Array.from({ length: 768 }, () => 0);
    levels[0] = 63;
    levels[1] = 62;
    expect(Array.from(decodePal(palPayload(levels)).colors.subarray(0, 2))).toEqual([255, 248]);
  });

  it('refuses a level above 63', () => {
    const levels = Array.from({ length: 768 }, () => 0);
    levels[5] = 64;
    expect(() => decodePal(palPayload(levels))).toThrow(/above 63/);
  });
});
