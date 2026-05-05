import { BinaryReader } from '../io/binary-reader.js';
import { uncompress } from '../resource/uncompress.js';
import { TRANSPARENT, type Sprite } from '../types.js';

export interface BmpResource { sprites: Sprite[]; }

export function decodeBmp(payload: Uint8Array): BmpResource {
  const r = new BinaryReader(payload.buffer, payload.byteOffset);
  r.expect('BMP:');
  r.u16(); r.u16();             // outer width, height (often unused)
  r.expect('INF:');
  r.u32();                      // dataSize
  const numImages = r.u16();
  const widths: number[] = []; for (let i = 0; i < numImages; i++) widths.push(r.u16());
  const heights: number[] = []; for (let i = 0; i < numImages; i++) heights.push(r.u16());
  r.expect('BIN:');
  const compSize = r.u32() - 5;
  const method = r.u8();
  const uncompSize = r.u32();
  const compInput = payload.subarray(r.pos, r.pos + compSize);
  const packed = uncompress(method, compInput, uncompSize);

  const sprites: Sprite[] = [];
  let off = 0;
  for (let i = 0; i < numImages; i++) {
    const w = widths[i]!, h = heights[i]!;
    if (w & 1) throw new Error(`bmp ${i}: odd width ${w}`);
    const indexed = new Uint8Array(w * h);
    for (let p = 0; p < (w * h) / 2; p++) {
      const hi = (packed[off]! >> 4) & 0x0f;
      const lo = packed[off]! & 0x0f;
      indexed[p * 2]     = hi === 0 ? TRANSPARENT : hi;
      indexed[p * 2 + 1] = lo === 0 ? TRANSPARENT : lo;
      off++;
    }
    sprites.push({ width: w, height: h, indexed });
  }
  return { sprites };
}
