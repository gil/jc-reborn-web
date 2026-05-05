import { BinaryReader } from '../io/binary-reader.js';

export interface PalResource { vga: Uint8Array; /* 256 × RGB, channels 0-63 */ }

export function decodePal(payload: Uint8Array): PalResource {
  const r = new BinaryReader(payload.buffer, payload.byteOffset);
  r.expect('PAL:');
  r.u16();                      // size
  r.u8(); r.u8();               // unknown
  r.expect('VGA:');
  r.u8(); r.u8(); r.u8(); r.u8(); // size header
  const vga = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    vga[i * 3 + 0] = r.u8();
    vga[i * 3 + 1] = r.u8();
    vga[i * 3 + 2] = r.u8();
  }
  return { vga };
}
