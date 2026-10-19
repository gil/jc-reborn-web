const PERCENT_SCALE = 0x28f;

export const RANDOM_START = {
  read: 24,
  write: 55,
  table: [
    0xdd23, 0x9533, 0xf3cd, 0x4bc2, 0xf7e2, 0xa2df, 0xaa70, 0x60aa,
    0x144b, 0x8948, 0x192a, 0x6b0d, 0x9e0b, 0xfbf1, 0x8607, 0x465d,
    0xeaf4, 0x69fd, 0x6c44, 0x1b27, 0xdb71, 0xe38f, 0xabb4, 0xdc47,
    0x0fde, 0x4d8e, 0xfc7d, 0x8d38, 0x5948, 0xe36f, 0xaa22, 0x2f26,
    0x43fa, 0xb5a5, 0x20eb, 0xed85, 0xf5c3, 0x819f, 0x2d9c, 0xb26d,
    0xe92b, 0x97d5, 0x3da1, 0x89ed, 0xe3f4, 0x74b5, 0x002c, 0xd35f,
    0x3b08, 0x0df5, 0xf27e, 0xc270, 0x2589, 0x2e8b, 0x6352, 0xda2d,
  ] as readonly number[],
};

export interface RandomSource {
  next(): number;
  percent(...weights: number[]): number;
}

export function percentPick(value: number, weights: readonly number[]): number {
  for (let i = 0; i < weights.length; i++) {
    const share = (weights[i]! * PERCENT_SCALE) & 0xffff;
    if (share > value) return i + 1;
    value -= share;
  }
  return 0;
}

export class StoryRandom implements RandomSource {
  private readonly table = [...RANDOM_START.table];
  private read = RANDOM_START.read;
  private write = RANDOM_START.write;

  get writeIndex(): number {
    return this.write;
  }

  next(): number {
    const at = this.write;
    this.table[at] = (this.table[at]! + this.table[this.read]!) & 0xffff;
    this.write = (this.write + 1) % this.table.length;
    this.read = (this.read + 1) % this.table.length;
    return this.table[at]!;
  }

  discard(count: number): void {
    for (let i = 0; i < count; i++) this.next();
  }

  percent(...weights: number[]): number {
    return percentPick(this.next(), weights);
  }
}

export function seedRandom(random: StoryRandom, seconds: number): void {
  random.discard(seconds & 0xffff);
}
