import { BinaryReader } from '../io/binary-reader.js';
import { uncompress } from '../resource/uncompress.js';

export interface ScrResource { width: number; height: number; indexed: Uint8Array; }

export function decodeScr(payload: Uint8Array): ScrResource {
  const r = new BinaryReader(payload.buffer, payload.byteOffset);
  r.expect('SCR:');
  r.u16(); r.u16();         // totalSize, flags
  r.expect('DIM:');
  r.u32();                  // dimSize
  const width = r.u16();
  const height = r.u16();
  r.expect('BIN:');
  const compSize = r.u32() - 5;
  const method = r.u8();
  const uncompSize = r.u32();
  const compInput = payload.subarray(r.pos, r.pos + compSize);
  const packed = uncompress(method, compInput, uncompSize);
  // 4-bit packed → indexed (high nibble first)
  const indexed = new Uint8Array(width * height);
  for (let i = 0, o = 0; i < packed.length; i++) {
    indexed[o++] = (packed[i]! >> 4) & 0x0f;
    indexed[o++] = packed[i]! & 0x0f;
  }
  return { width, height, indexed };
}
