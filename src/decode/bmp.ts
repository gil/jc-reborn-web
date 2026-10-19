import { unpackChunk } from '../resource/uncompress.js';
import type { Sprite } from '../types.js';
import { chunkBody } from './chunks.js';
import { unpackNibbles } from './nibbles.js';

export interface BmpResource { sprites: Sprite[]; }

export function decodeBmp(payload: Uint8Array): BmpResource {
  const info = chunkBody(payload, 'BMP:INF:');
  const bin = chunkBody(payload, 'BMP:BIN:');
  if (!info || !bin) throw new Error('BMP:INF: or BMP:BIN: missing');
  const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const count = view.getUint16(0, true);
  const packed = unpackChunk(bin);
  const sprites: Sprite[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const width = view.getUint16(2 + 2 * i, true);
    const height = view.getUint16(2 + 2 * (count + i), true);
    if (width & 1) throw new Error(`bmp ${i}: odd width ${width}`);
    sprites.push({ width, height, indexed: unpackNibbles(packed, width * height, offset) });
    offset += (width / 2) * height;
  }
  return { sprites };
}
