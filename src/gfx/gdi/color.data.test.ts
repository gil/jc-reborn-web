import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureRows } from '../../testing/corpus.js';
import { brushColorAt } from './color.js';

describe.skipIf(!hasFixture('graphics/brushes.tsv'))('brushes match the original SCRANTIC.SCR', () => {
  it('makes a solid brush below 16 and the same 8x8 pattern from 16 on', () => {
    // SCRANTIC 1038:1d31
    const wrong = readFixtureRows('graphics/brushes.tsv').flatMap(([colorText, kind, low, , bits]) => {
      const color = Number(colorText);
      if (color < 16) {
        const expectedLow = color | ((0x10 + color) << 8);
        return kind === 'solid' && parseInt(low!, 16) === expectedLow ? [] : [`${color}: ${kind} ${low}`];
      }
      if (kind !== 'pattern') return [`${color}: ${kind}`];
      const bytes = Uint8Array.from(bits!.match(/../g)!.map((pair) => parseInt(pair, 16)));
      for (let row = 0; row < 8; row++) {
        for (let x = 0; x < 8; x++) {
          const byte = bytes[row * 4 + (x >> 1)]!;
          const index = x & 1 ? byte & 0x0f : byte >> 4;
          if (index !== brushColorAt(color, x, 7 - row)) return [`${color}: buffer row ${row} x ${x}`];
        }
      }
      return [];
    });
    expect(wrong).toEqual([]);
  });
});
