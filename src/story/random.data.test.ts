import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureBytes, readFixtureRows } from '../testing/corpus.js';
import { RANDOM_START, StoryRandom } from './random.js';

describe.skipIf(!hasFixture('story/random.tsv'))('random generator matches the original SCRANTIC.SCR', () => {
  it('starts from the same table', () => {
    // SCRANTIC 1068:1ce4
    const bytes = readFixtureBytes('story/random-table.bin');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const table = Array.from({ length: 56 }, (_, i) => view.getUint16(4 + 2 * i, true));
    expect({ read: view.getUint16(0, true), write: view.getUint16(2, true), table }).toEqual({ ...RANDOM_START, table: [...RANDOM_START.table] });
  });

  it('draws the same numbers and percent picks', () => {
    // SCRANTIC 1018:1e60 1018:1eb6 1018:1ef5
    const generators = new Map<string, StoryRandom>();
    const wrong: string[] = [];
    for (const [kind, seed, call, value] of readFixtureRows('story/random.tsv')) {
      const key = kind === 'next' ? `next ${seed}` : 'percent';
      if (!generators.has(key)) {
        const random = new StoryRandom();
        random.discard(Number(seed));
        generators.set(key, random);
      }
      const random = generators.get(key)!;
      const ours = kind === 'next' ? random.next() : random.percent(...kind!.slice('percent:'.length).split(',').map(Number));
      if (ours !== Number(value)) wrong.push(`${kind} ${seed} ${call}: ours ${ours}, original ${value}`);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });
});
