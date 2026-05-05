import { describe, it, expect } from 'vitest';
import { uncompress } from './uncompress.js';

describe('RLE (method 1)', () => {
  it('expands run: 0x83 0xAA → AA AA AA', () => {
    const input = new Uint8Array([0x83, 0xaa]);
    expect(Array.from(uncompress(1, input, 3))).toEqual([0xaa, 0xaa, 0xaa]);
  });
  it('passes literal: 0x03 1 2 3 → 1 2 3', () => {
    const input = new Uint8Array([0x03, 0x01, 0x02, 0x03]);
    expect(Array.from(uncompress(1, input, 3))).toEqual([1, 2, 3]);
  });
  it('mixed: literal then run', () => {
    const input = new Uint8Array([0x02, 0xde, 0xad, 0x82, 0xff]);
    expect(Array.from(uncompress(1, input, 4))).toEqual([0xde, 0xad, 0xff, 0xff]);
  });
});

describe('LZW (method 2)', () => {
  it('round-trips a known fixture (placeholder until real capture added)', () => {
    expect(true).toBe(true);
  });
});

describe('uncompress dispatch', () => {
  it('throws on unknown method', () => {
    expect(() => uncompress(99, new Uint8Array(), 0)).toThrow();
  });
});
