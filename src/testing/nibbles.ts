import { TRANSPARENT } from '../types.js';

export function packNibbles(indexed: Uint8Array): Uint8Array {
  const packed = new Uint8Array(Math.ceil(indexed.length / 2));
  indexed.forEach((index, i) => {
    const nibble = index === TRANSPARENT ? 0 : index;
    packed[i >> 1] = (packed[i >> 1] ?? 0) | (i & 1 ? nibble : nibble << 4);
  });
  return packed;
}
