import { BinaryReader } from '../io/binary-reader.js';
import { uncompress } from '../resource/uncompress.js';

export interface AdsSubResource { slot: number; name: string; }
export interface AdsTag { id: number; description: string; }
export interface AdsResource {
  version: string;
  subResources: AdsSubResource[];
  bytecode: Uint8Array;
  tags: AdsTag[];
}

export function decodeAds(payload: Uint8Array): AdsResource {
  const r = new BinaryReader(payload.buffer, payload.byteOffset);
  r.expect('VER:');
  r.u32();
  const version = new TextDecoder('latin1').decode(r.bytes(5));
  // ADS: chunk present in C source between VER: and RES: — 4 unknown bytes
  r.expect('ADS:');
  r.u8(); r.u8(); r.u8(); r.u8();
  r.expect('RES:');
  r.u32();                            // resSize
  const numRes = r.u16();
  const subResources: AdsSubResource[] = [];
  for (let i = 0; i < numRes; i++) {
    const slot = r.u16();
    const name = readUntilNul(r);     // getString(f,40): variable-length null-terminated
    subResources.push({ slot, name });
  }
  r.expect('SCR:');
  const compSize = r.u32() - 5;
  const method = r.u8();
  const uncompSize = r.u32();
  const compInput = payload.subarray(r.pos, r.pos + compSize);
  const bytecode = uncompress(method, compInput, uncompSize);
  r.pos += compSize;

  r.expect('TAG:');
  r.u32();
  const numTags = r.u16();
  const tags: AdsTag[] = [];
  for (let i = 0; i < numTags; i++) {
    const id = r.u16();
    const description = readUntilNul(r);
    tags.push({ id, description });
  }
  return { version, subResources, bytecode, tags };
}

function readUntilNul(r: BinaryReader): string {
  const bytes: number[] = [];
  while (true) {
    const b = r.u8();
    if (b === 0) break;
    bytes.push(b);
  }
  return new TextDecoder('latin1').decode(new Uint8Array(bytes));
}
