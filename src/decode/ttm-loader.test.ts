import { describe, expect, it } from 'vitest';
import { ascii, chunk, concat, storedBody, words } from '../testing/build-chunks.js';
import { decodeTtm } from './ttm-loader.js';

const TWO_PAGES = words(0x1111, 7, 0x0ff0, 0x2002, 1, 2, 0x0ff0);

function ttmPayload(pageCount: number | null, bytecode: Uint8Array): Uint8Array {
  const pag = pageCount === null ? [] : [chunk('PAG:', words(pageCount))];
  const tti = chunk('TTI:', chunk('TAG:', concat(words(1, 9), ascii('x\0'))), true);
  return concat(chunk('VER:', ascii('4.09\0')), ...pag, chunk('TT3:', storedBody(bytecode)), tti);
}

describe('decodeTtm', () => {
  // SCRANTIC 1050:0177 1050:04d6 1050:042a
  it('indexes where each page starts and which page each bytecode tag is on', () => {
    expect(decodeTtm(ttmPayload(2, TWO_PAGES))).toEqual({
      pageCount: 2,
      bytecode: TWO_PAGES,
      pageOffsets: [0, 6],
      tags: [{ id: 7, page: 0 }],
    });
  });

  // SCRANTIC 1050:0177 1050:04d6
  it('uses 330 pages when PAG: is missing and stops indexing at the end of the bytecode', () => {
    expect(decodeTtm(ttmPayload(null, TWO_PAGES))).toMatchObject({ pageCount: 330, pageOffsets: [0, 6, 14] });
  });

  it('refuses a TTM without TT3:', () => {
    expect(() => decodeTtm(chunk('PAG:', words(1)))).toThrow(/TT3: missing/);
  });
});
