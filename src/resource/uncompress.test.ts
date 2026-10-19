import { describe, expect, it } from 'vitest';
import { uncompress, unpackChunk } from './uncompress.js';

const STORED = 0;
const RLE = 1;
const LZW = 2;

function chunkBody(method: number, size: number, data: ArrayLike<number>): Uint8Array {
  const body = new Uint8Array(5 + data.length);
  body[0] = method;
  new DataView(body.buffer).setUint32(1, size, true);
  body.set(data, 5);
  return body;
}

function packCodes(codes: Array<[code: number, bits: number]>): Uint8Array {
  const bytes: number[] = [];
  let acc = 0;
  let held = 0;
  for (const [code, bits] of codes) {
    acc |= code << held;
    held += bits;
    while (held >= 8) {
      bytes.push(acc & 0xff);
      acc >>>= 8;
      held -= 8;
    }
  }
  if (held > 0) bytes.push(acc & 0xff);
  return new Uint8Array(bytes);
}

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const decoded = (method: number, size: number, data: ArrayLike<number>) => Array.from(unpackChunk(chunkBody(method, size, data)));

describe('stored (method 0)', () => {
  // SCRANTIC 1028:0000
  it('copies the input unchanged', () => {
    expect(decoded(STORED, 3, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('stops at the end of input with the bytes produced so far', () => {
    expect(decoded(STORED, 5, [1, 2])).toEqual([1, 2]);
  });

  it('stops at the requested size', () => {
    expect(decoded(STORED, 2, [1, 2, 3])).toEqual([1, 2]);
  });
});

describe('RLE (method 1)', () => {
  // SCRANTIC 1028:0024
  it('copies the next count bytes when bit 7 is clear', () => {
    expect(decoded(RLE, 3, [0x03, 1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('repeats the next byte count times when bit 7 is set', () => {
    expect(decoded(RLE, 3, [0x83, 0xaa])).toEqual([0xaa, 0xaa, 0xaa]);
  });

  it('a zero-length run still consumes its value byte', () => {
    expect(decoded(RLE, 2, [0x80, 0xff, 0x02, 0xde, 0xad])).toEqual([0xde, 0xad]);
  });

  it('a zero-length literal copies nothing', () => {
    expect(decoded(RLE, 2, [0x00, 0x02, 0xde, 0xad])).toEqual([0xde, 0xad]);
  });

  it('stops at the end of input with the bytes produced so far', () => {
    expect(decoded(RLE, 5, [0x02, 0xde, 0xad])).toEqual([0xde, 0xad]);
  });

  it('stops at the requested size inside a run', () => {
    expect(decoded(RLE, 2, [0x85, 0xaa])).toEqual([0xaa, 0xaa]);
  });

  it('a run with no value byte left repeats 0xff', () => {
    expect(decoded(RLE, 3, [0x83])).toEqual([0xff, 0xff, 0xff]);
  });

  // SCRANTIC 1028:022e
  it('stops at the requested size inside a literal', () => {
    expect(decoded(RLE, 2, [0x04, 1, 2, 3, 4])).toEqual([1, 2]);
  });
});

describe('LZW (method 2)', () => {
  // SCRANTIC 1028:0e04 1028:0fc1
  it('adds the previous string plus the first byte of the current one as the next code', () => {
    expect(decoded(LZW, 4, packCodes([[65, 9], [66, 9], [257, 9]]))).toEqual(ascii('ABAB'));
  });

  it('decodes a code that is not in the table yet as previous string plus its first byte', () => {
    expect(decoded(LZW, 3, packCodes([[65, 9], [257, 9]]))).toEqual(ascii('AAA'));
  });

  it('stops at the end of input with the bytes produced so far', () => {
    expect(decoded(LZW, 10, packCodes([[65, 9], [66, 9]]))).toEqual(ascii('AB'));
  });

  it('clear code skips to the next code group and restarts the table', () => {
    expect(decoded(LZW, 2, packCodes([[65, 9], [256, 9], [0, 54], [66, 9]]))).toEqual(ascii('AB'));
  });

  it('widens codes to 10 bits once entry 511 is added', () => {
    const codes: Array<[number, number]> = [[65, 9]];
    for (let code = 257; code < 512; code++) codes.push([code, 9]);
    codes.push([512, 10]);
    const out = unpackChunk(chunkBody(LZW, 33153, packCodes(codes)));
    expect(out.length).toBe(33153);
    expect(out.every((b) => b === 65)).toBe(true);
  });

  // SCRANTIC 1028:0e04
  it('decodes the code right after a clear as a normal code, even 256', () => {
    expect(decoded(LZW, 5, packCodes([[65, 9], [256, 9], [0, 54], [256, 9]]))).toEqual(ascii('AAA'));
  });

  it('outputs 0xff for an empty input', () => {
    expect(decoded(LZW, 5, [])).toEqual([0xff]);
  });

  it('outputs the low byte of a first code above 255', () => {
    expect(decoded(LZW, 5, packCodes([[300, 9], [65, 9]]))).toEqual([0x2c, 0x41]);
  });

  it('stops adding entries and stays at 12 bits once the table holds 4096 codes', () => {
    const codes: Array<[number, number]> = [[65, 9]];
    let width = 9;
    let free = 257;
    for (let i = 1; i < 4096 - 256; i++) {
      if (free > (1 << width) - 1 && width < 12) width++;
      codes.push([i % 2 ? 66 : 65, width]);
      free++;
    }
    codes.push([4095, 12], [300, 12], [65, 12]);
    const fill = 'A' + 'BA'.repeat((4096 - 257) >> 1) + 'B';
    expect(decoded(LZW, 5000, packCodes(codes))).toEqual(ascii(fill + 'AB' + 'BA' + 'A'));
  });

  // SCRANTIC 1028:0fc1
  it('reads only codes that fit entirely in the last group', () => {
    expect(decoded(LZW, 5, [0x41, 0x84, 0xfc])).toEqual(ascii('AB'));
  });

  it('throws away the rest of the group after a clear', () => {
    expect(decoded(LZW, 3, packCodes([[65, 9], [256, 9], [66, 9], [0, 45], [67, 9]]))).toEqual(ascii('AC'));
  });
});

describe('unpackChunk', () => {
  // SCRANTIC 1028:0615
  it('reads the method byte and the u32 uncompressed size from the chunk body', () => {
    expect(decoded(RLE, 3, [0x83, 0xaa])).toEqual([0xaa, 0xaa, 0xaa]);
  });

  // SCRANTIC 1028:0547
  it('rejects a method the original cannot open', () => {
    expect(() => uncompress(3, new Uint8Array([0]), 1)).toThrow(/method 3/);
  });
});
