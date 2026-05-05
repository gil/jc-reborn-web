import { BinaryReader } from '../io/binary-reader.js';
import type { MapEntry } from './types.js';

export interface MapFile {
  resFileName: string;
  entries: MapEntry[];
}

export function parseMap(buf: ArrayBuffer): MapFile {
  const r = new BinaryReader(buf);
  r.bytes(6);                          // 6 unknown header bytes
  const resFileName = r.fixedString(13);
  const numEntries = r.u16();
  const entries: MapEntry[] = [];
  for (let i = 0; i < numEntries; i++) {
    const length = r.u32();
    const offset = r.u32();
    entries.push({ name: '', length, offset }); // name read from .001
  }
  return { resFileName, entries };
}
