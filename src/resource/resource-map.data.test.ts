import { describe, expect, it } from 'vitest';
import { hasCorpus, readDataFile } from '../testing/corpus.js';
import { parseMap, resourceNameHash } from './resource-map.js';

const ENTRIES_START = 21;
const ENTRY_SIZE = 8;

function storedName(archive: Uint8Array, offset: number): string {
  return String.fromCharCode(...archive.subarray(offset, offset + 13)).replace(/\0.*$/s, '');
}

describe.skipIf(!hasCorpus)('the real RESOURCE.MAP', () => {
  it('has one archive, 180 entries, and nothing after them', () => {
    // SCRANTIC 1018:1771
    const buf = readDataFile('RESOURCE.MAP');
    const map = parseMap(buf);
    expect(map.hashPositions).toEqual([0, 1, 5, 7]);
    expect(map.resFileName).toBe('RESOURCE.001');
    expect(map.entries).toHaveLength(180);
    expect(buf.byteLength).toBe(ENTRIES_START + ENTRY_SIZE * map.entries.length);
  });

  it('stores the hash of the name found at each entry offset', () => {
    // SCRANTIC 1018:195a 1018:1019
    const map = parseMap(readDataFile('RESOURCE.MAP'));
    const archive = new Uint8Array(readDataFile('RESOURCE.001'));
    const wrong = map.entries
      .map(({ nameHash, offset }) => ({ name: storedName(archive, offset), nameHash }))
      .filter(({ name, nameHash }) => resourceNameHash(name, map.hashPositions) !== nameHash);
    expect(wrong).toEqual([]);
  });

  it('has no two entries with the same hash', () => {
    const map = parseMap(readDataFile('RESOURCE.MAP'));
    expect(new Set(map.entries.map((entry) => entry.nameHash)).size).toBe(map.entries.length);
  });
});
