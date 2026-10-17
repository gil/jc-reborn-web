import { describe, expect, it } from 'vitest';
import { walkChunks } from './corpus.js';

function chunk(tag: string, size: number, body: number[] = []): number[] {
  return [...Array.from(tag, (c) => c.charCodeAt(0)), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, size >>> 24, ...body];
}

describe('walkChunks', () => {
  it('walks nested containers and reports body offsets', () => {
    const inner = chunk('BIN:', 2, [7, 8]);
    const payload = new Uint8Array(chunk('BMP:', (0x80000000 | inner.length) >>> 0, inner));
    expect(walkChunks(payload)).toEqual([
      { path: 'BMP:', bodyOffset: 8, size: 10, container: true },
      { path: 'BMP:BIN:', bodyOffset: 16, size: 2, container: false },
    ]);
  });

  it('rejects a chunk that overruns its parent', () => {
    expect(() => walkChunks(new Uint8Array(chunk('BIN:', 16, [1, 2, 3])))).toThrow(/overruns/);
  });

  it('rejects stray bytes after the last chunk', () => {
    expect(() => walkChunks(new Uint8Array([...chunk('BIN:', 0), 1, 2]))).toThrow(/stray/);
  });
});
