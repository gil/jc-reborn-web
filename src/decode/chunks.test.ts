import { describe, expect, it } from 'vitest';
import { ascii, chunk, concat, words } from '../testing/build-chunks.js';
import { chunkBody, findChunk } from './chunks.js';

const TTM_LIKE = concat(
  chunk('VER:', ascii('4.09\0')),
  chunk('TTI:', chunk('TAG:', concat(words(1), ascii('A\0'))), true),
  chunk('PAG:', words(3)),
);

describe('findChunk', () => {
  // SCRANTIC 1038:0215 1038:0517
  it('finds top-level and nested chunks by their full tag path', () => {
    expect(findChunk(TTM_LIKE, 'VER:')).toMatchObject({ bodyOffset: 8, size: 5 });
    expect(findChunk(TTM_LIKE, 'TTI:')).toMatchObject({ bodyOffset: 21, size: 12, container: true });
    expect(findChunk(TTM_LIKE, 'TTI:TAG:')).toMatchObject({ bodyOffset: 29, size: 4 });
    expect(findChunk(TTM_LIKE, 'PAG:')).toMatchObject({ bodyOffset: 41, size: 2 });
  });

  // SCRANTIC 1038:0215
  it('does not match a nested chunk by its last tag alone', () => {
    expect(findChunk(TTM_LIKE, 'TAG:')).toBeUndefined();
  });

  // SCRANTIC 1038:0215
  it('refuses paths that are not made of 4-byte tags', () => {
    expect(findChunk(TTM_LIKE, '')).toBeUndefined();
    expect(findChunk(TTM_LIKE, 'PAG')).toBeUndefined();
    expect(findChunk(TTM_LIKE, 'XYZ:')).toBeUndefined();
  });
});

describe('chunkBody', () => {
  it('returns the body bytes of the chunk', () => {
    expect(Array.from(chunkBody(TTM_LIKE, 'PAG:')!)).toEqual([3, 0]);
    expect(chunkBody(TTM_LIKE, 'XYZ:')).toBeUndefined();
  });
});
