import { BinaryReader } from '../io/binary-reader.js';
import type { MapEntry } from './types.js';

const NAME_FIELD = 13;
const PATH_SEPARATORS = new Set([0x5c, 0x3a]);

export interface MapFile {
  hashPositions: number[];
  resFileName: string;
  entries: MapEntry[];
}

export function parseMap(buf: ArrayBuffer): MapFile {
  const r = new BinaryReader(buf);
  const hashPositions = Array.from(r.bytes(4), (b) => (b << 24) >> 24);
  const archiveCount = r.u16();
  if (archiveCount !== 1) throw new Error(`RESOURCE.MAP lists ${archiveCount} archives, expected 1`);
  const resFileName = r.fixedString(NAME_FIELD);
  const count = r.u16();
  const entries: MapEntry[] = [];
  for (let i = 0; i < count; i++) entries.push({ nameHash: r.u32(), offset: r.u32() });
  return { hashPositions, resFileName, entries };
}

export function resourceNameHash(path: string, positions: readonly number[]): number {
  const chars = Array.from(path, (c) => {
    const code = c.charCodeAt(0);
    return code >= 0x61 && code <= 0x7a ? code ^ 0x20 : code;
  });
  let sum = 0;
  let xor = 0;
  let nameStart = 0;
  chars.forEach((code, i) => {
    const signed = (code << 24) >> 24;
    sum = ((sum + signed) << 16) >> 16;
    xor = ((xor ^ signed) << 16) >> 16;
    if (PATH_SEPARATORS.has(code)) {
      sum = 0;
      xor = 0;
      nameStart = i + 1;
    }
  });
  const name = chars.slice(nameStart, nameStart + NAME_FIELD);
  let hash = 0;
  for (const p of positions) hash = ((hash << 8) + (((name[p] ?? 0) << 24) >> 24)) >>> 0;
  return (hash + ((Math.imul(sum, xor) << 16) >> 16)) >>> 0;
}
