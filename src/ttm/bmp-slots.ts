import { decodeBmp } from '../decode/bmp.js';
import type { ParsedArchive } from '../resource/types.js';
import type { TtmSlot } from './thread.js';

export function loadBmpIntoSlot(archive: ParsedArchive, slot: TtmSlot, slotNo: number, name: string): void {
  const res = archive.byName.get(name);
  if (!res) throw new Error(`bmp not found: ${name}`);
  slot.sprites[slotNo] = decodeBmp(res.payload).sprites;
}

export function releaseBmpSlot(slot: TtmSlot, slotNo: number): void {
  slot.sprites[slotNo] = [];
}
