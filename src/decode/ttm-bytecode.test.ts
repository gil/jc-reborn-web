import { describe, expect, it } from 'vitest';
import { ascii, concat, words } from '../testing/build-chunks.js';
import { readTtmInstruction } from './ttm-bytecode.js';

describe('readTtmInstruction', () => {
  // SCRANTIC 1050:04d6
  it('reads as many word args as the low nibble says, up to 7', () => {
    expect(readTtmInstruction(words(0x2002, 1, 0xffff), 0)).toEqual({ offset: 0, opcode: 0x2002, args: [1, 0xffff], next: 6 });
    expect(readTtmInstruction(words(0, 0x0ff0), 2)).toEqual({ offset: 2, opcode: 0x0ff0, args: [], next: 4 });
  });

  // SCRANTIC 1050:04a8
  it('reads a string arg and pads its field to an even length', () => {
    expect(readTtmInstruction(concat(words(0xf01f), ascii('AB\0\0'), words(0)), 0)).toEqual({
      offset: 0,
      opcode: 0xf01f,
      args: [],
      text: 'AB',
      next: 6,
    });
    expect(readTtmInstruction(concat(words(0xf02f), ascii('ABC\0'), words(0)), 0)).toMatchObject({ text: 'ABC', next: 6 });
  });

  // SCRANTIC 1050:04d6
  it('reads a pair count and that many word pairs for 0xAF1F and 0xAF2F', () => {
    expect(readTtmInstruction(words(0xaf1f, 2, 1, 2, 3, 4, 0x0ff0), 0)).toMatchObject({ args: [2, 1, 2, 3, 4], next: 12 });
    expect(readTtmInstruction(words(0xaf2f, 0, 0x0ff0), 0)).toMatchObject({ args: [0], next: 4 });
  });

  // SCRANTIC 1050:04d6
  it('refuses arg codes 8 to 14', () => {
    expect(() => readTtmInstruction(words(0x0018), 0)).toThrow(/arg code 8/);
    expect(() => readTtmInstruction(words(0x001e), 0)).toThrow(/arg code 14/);
  });

  it('refuses a string that runs past the end', () => {
    expect(() => readTtmInstruction(concat(words(0xf01f), ascii('AB')), 0)).toThrow(/past the end/);
  });
});
