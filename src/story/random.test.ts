import { describe, expect, it } from 'vitest';
import { percentPick, RANDOM_START, seedRandom, StoryRandom } from './random.js';

describe('story random generator', () => {
  it('adds the read slot into the write slot and returns it', () => {
    // SCRANTIC 1018:1e60
    const { read, write, table } = RANDOM_START;
    expect(new StoryRandom().next()).toBe((table[write]! + table[read]!) & 0xffff);
  });

  it('moves both indices by one and wraps at 56', () => {
    // SCRANTIC 1018:1e60
    const random = new StoryRandom();
    random.next();
    expect(random.writeIndex).toBe(0);
    random.discard(55);
    expect(random.writeIndex).toBe(55);
  });

  it('seeds by dropping time & 0xffff numbers', () => {
    // SCRANTIC 1018:1ed4 1018:1eb6 1000:082c
    const seeded = new StoryRandom();
    seedRandom(seeded, 0x10003);
    const manual = new StoryRandom();
    manual.discard(3);
    expect(seeded.next()).toBe(manual.next());
  });
});

describe('percent pick', () => {
  it('returns the first weight whose share exceeds the remaining value', () => {
    // SCRANTIC 1018:1ef5
    expect(percentPick(0, [50])).toBe(1);
    expect(percentPick(50 * 0x28f - 1, [50])).toBe(1);
    expect(percentPick(50 * 0x28f, [50])).toBe(0);
    expect(percentPick(5 * 0x28f, [5, 10, 15])).toBe(2);
    expect(percentPick(15 * 0x28f, [5, 10, 15])).toBe(3);
    expect(percentPick(30 * 0x28f, [5, 10, 15])).toBe(0);
  });
});
