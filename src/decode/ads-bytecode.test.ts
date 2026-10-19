import { describe, expect, it } from 'vitest';
import { words } from '../testing/build-chunks.js';
import { adsArgCount, indexAdsSections } from './ads-bytecode.js';

describe('adsArgCount', () => {
  // SCRANTIC 1048:0303 1048:0383
  it('gives the arg count the original size table gives', () => {
    expect([0x2005, 0x2010, 0x4000, 0x1350, 0xf010, 0xf200, 0x3020, 0xf000].map(adsArgCount)).toEqual([4, 3, 3, 2, 1, 1, 1, 0]);
  });

  // SCRANTIC 1048:0303
  it('gives 0 for every opcode outside the table', () => {
    expect([0x1520, 0x1510, 0x2014, 0xffff, 0x0001].map(adsArgCount)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('indexAdsSections', () => {
  // SCRANTIC 1048:04fc 1048:05cd
  it('starts every section after its tag word and ends it at a 0xFFFF', () => {
    const bytecode = words(1, 0x2005, 1, 2, 0, 1, 0xffff, 5, 0x1510, 0xffff);
    expect(indexAdsSections(bytecode)).toEqual([
      { tag: 1, offset: 2 },
      { tag: 5, offset: 16 },
    ]);
  });

  // SCRANTIC 1048:04fc 1048:0303
  it('reads a 0xFFFF as an arg when the opcode before it takes one', () => {
    expect(indexAdsSections(words(1, 0xf010, 0xffff, 0x1510, 0xffff))).toEqual([{ tag: 1, offset: 2 }]);
  });

  // SCRANTIC 1048:04fc 1048:0628
  it('counts only sections closed by a 0xFFFF', () => {
    expect(indexAdsSections(words(1, 0xffff, 2, 0x1510))).toEqual([{ tag: 1, offset: 2 }]);
    expect(indexAdsSections(words(1, 0xffff, 2, 0x1510, 0xffff))).toEqual([
      { tag: 1, offset: 2 },
      { tag: 2, offset: 6 },
    ]);
    expect(indexAdsSections(words(1, 0x1510))).toEqual([]);
  });

  // SCRANTIC 1048:04fc
  it('starts no section after a 0xFFFF at the very end', () => {
    expect(indexAdsSections(words(1, 0xffff))).toEqual([{ tag: 1, offset: 2 }]);
    expect(indexAdsSections(words(1, 0xffff, 2))).toEqual([{ tag: 1, offset: 2 }]);
  });
});
