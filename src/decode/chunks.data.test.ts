import { describe, expect, it } from 'vitest';
import { CHUNKED_TYPES, hasCorpus, hasFixture, loadArchive, readFixtureRows, walkChunks } from '../testing/corpus.js';
import { findChunk } from './chunks.js';

const LOADER_PATHS: Record<string, string[]> = {
  '.BMP': ['BMP:INF:', 'BMP:BIN:'],
  '.SCR': ['SCR:DIM:', 'SCR:BIN:'],
  '.PAL': ['PAL:VGA:'],
  '.TTM': ['PAG:', 'TT3:'],
  '.ADS': ['ADS:RES:', 'ADS:SCR:'],
};

describe.skipIf(!hasFixture('loaders/chunks.tsv'))('chunk lookup matches the original SCRANTIC.SCR', () => {
  it('finds the same body position and size for every path asked of the original', () => {
    // SCRANTIC 1038:0215 1038:0517
    const archive = loadArchive();
    const rows = readFixtureRows('loaders/chunks.tsv');
    const wrong = rows.flatMap(([resource, path, position, size]) => {
      const found = findChunk(archive.byName.get(resource!)!.payload, path!);
      const ours = found ? `${found.bodyOffset} ${found.size & 0xffff}` : '-1 -1';
      return ours === `${position} ${size}` ? [] : [`${resource} ${path}: ours ${ours}, original ${position} ${size}`];
    });
    expect(new Set(rows.map(([resource]) => resource)).size).toBe(179);
    expect(wrong).toEqual([]);
  });
});

describe.skipIf(!hasCorpus)('chunk order in the real data', () => {
  it('stores the chunks each loader asks for in the order it asks, so a forward-only search finds them all', () => {
    // SCRANTIC 1038:0215
    const outOfOrder = loadArchive()
      .list.filter((resource) => CHUNKED_TYPES.has(resource.type))
      .flatMap((resource) => {
        const offsets = LOADER_PATHS[resource.type]!.map((path) => findChunk(resource.payload, path)?.bodyOffset ?? -1);
        const ordered = offsets.every((offset, i) => offset > (offsets[i - 1] ?? 0));
        return ordered ? [] : [`${resource.name}: ${offsets.join(' ')}`];
      });
    expect(outOfOrder).toEqual([]);
  });

  it('keeps every leaf chunk under 64 KB, so the 16-bit size from 1038:0517 is the whole size', () => {
    // SCRANTIC 1038:0517
    const large = loadArchive()
      .list.filter((resource) => CHUNKED_TYPES.has(resource.type))
      .flatMap((resource) => {
        const chunks = walkChunks(resource.payload).filter((chunk) => !chunk.container && chunk.size > 0xffff);
        return chunks.map((chunk) => `${resource.name} ${chunk.path} ${chunk.size}`);
      });
    expect(large).toEqual([]);
  });
});
