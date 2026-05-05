import { BinaryReader } from '../io/binary-reader.js';
import type { MapFile } from './resource-map.js';
import type { ParsedArchive, RawResource } from './types.js';

export function indexArchive(map: MapFile, archive: ArrayBuffer): ParsedArchive {
  const r = new BinaryReader(archive);
  const list: RawResource[] = [];
  const byName = new Map<string, RawResource>();
  for (const entry of map.entries) {
    r.pos = entry.offset;
    const name = r.fixedString(13);
    const size = r.u32();
    const payload = r.bytes(size);
    const type = name.slice(name.length - 4);
    const res: RawResource = { name, type, payload };
    list.push(res);
    byName.set(name, res);
  }
  return { byName, list };
}
