import { TRANSPARENT } from '../types.js';

export function unpackNibbles(packed: Uint8Array, pixelCount: number, from = 0): Uint8Array {
  const needed = Math.ceil(pixelCount / 2);
  if (from + needed > packed.length) throw new Error(`pixel data short: need ${needed} bytes at ${from}, have ${packed.length - from}`);
  const indexed = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const byte = packed[from + (i >> 1)]!;
    const index = i & 1 ? byte & 0x0f : byte >> 4;
    indexed[i] = index === 0 ? TRANSPARENT : index;
  }
  return indexed;
}
