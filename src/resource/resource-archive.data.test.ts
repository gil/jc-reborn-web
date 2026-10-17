import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { CHUNKED_TYPES, hasCorpus, loadArchive, readDataFile, walkChunks } from '../testing/corpus.js';
import { parseMap } from './resource-map.js';

const RESOURCE_HEADER_SIZE = 13 + 4;

describe.skipIf(!hasCorpus)('the real RESOURCE.001', () => {
  it('holds every resource back to back, from offset 0 to the end of the file', () => {
    // SCRANTIC 1018:1019
    const map = parseMap(readDataFile('RESOURCE.MAP'));
    const archive = loadArchive();
    const spans = map.entries
      .map((entry, i) => ({ start: entry.offset, end: entry.offset + RESOURCE_HEADER_SIZE + archive.list[i]!.payload.length }))
      .sort((a, b) => a.start - b.start);
    expect(spans[0]!.start).toBe(0);
    expect(spans.slice(1).filter((span, i) => span.start !== spans[i]!.end)).toEqual([]);
    expect(spans.at(-1)!.end).toBe(readDataFile('RESOURCE.001').byteLength);
  });

  it('has 180 resources of six types', () => {
    const counts: Record<string, number> = {};
    for (const resource of loadArchive().list) counts[resource.type] = (counts[resource.type] ?? 0) + 1;
    expect(counts).toEqual({ '.BMP': 117, '.TTM': 41, '.SCR': 10, '.ADS': 10, '.PAL': 1, '.VIN': 1 });
  });

  it('stores every chunked payload as one complete chunk tree', () => {
    const broken = loadArchive()
      .list.filter((resource) => CHUNKED_TYPES.has(resource.type))
      .flatMap((resource) => {
        try {
          walkChunks(resource.payload);
          return [];
        } catch (error) {
          return [`${resource.name}: ${(error as Error).message}`];
        }
      });
    expect(broken).toEqual([]);
  });

  it('finds every resource an ADS file asks for by its exact stored name', () => {
    // SCRANTIC 1048:0079 1018:1019
    const archive = loadArchive();
    const missing = archive.list
      .filter((resource) => resource.type === '.ADS')
      .flatMap((resource) => decodeAds(resource.payload).subResources.map((sub) => sub.name))
      .filter((name) => !archive.byName.has(name));
    expect(missing).toEqual([]);
  });
});
