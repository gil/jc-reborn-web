import { BinaryReader } from '../io/binary-reader.js';
import { uncompress } from '../resource/uncompress.js';

export interface TtmTag { id: number; description: string; offset: number; }
export interface TtmResource {
  version: string;
  numPages: number;
  bytecode: Uint8Array;
  tags: TtmTag[];
}

export function decodeTtm(payload: Uint8Array): TtmResource {
  const r = new BinaryReader(payload.buffer, payload.byteOffset);
  r.expect('VER:');
  r.u32();                      // versionSize
  const version = new TextDecoder('latin1').decode(r.bytes(5));
  r.expect('PAG:');
  const numPages = r.u32();
  r.u8(); r.u8();
  r.expect('TT3:');
  const compSize = r.u32() - 5;
  const method = r.u8();
  const uncompSize = r.u32();
  const compInput = payload.subarray(r.pos, r.pos + compSize);
  const bytecode = uncompress(method, compInput, uncompSize);
  r.pos += compSize;

  r.expect('TTI:');
  r.u8(); r.u8(); r.u8(); r.u8();
  r.expect('TAG:');
  r.u32();                      // tagSize
  const numTags = r.u16();
  const tags: TtmTag[] = [];
  for (let i = 0; i < numTags; i++) {
    const id = r.u16();
    const description = readUntilNul(r); // getString(f,40): variable-length null-terminated
    tags.push({ id, description, offset: 0 });
  }
  return { version, numPages, bytecode, tags };
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
