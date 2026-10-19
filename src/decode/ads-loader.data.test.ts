import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ADS_OP, IF_OPCODES, WHILE_OPCODES } from '../ads/script.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { adsArgCount } from './ads-bytecode.js';
import { decodeAds } from './ads-loader.js';

const SECTION_END = 0xffff;
const ORIGINAL_SECTION_SLOTS = 80;
const NAMED_OPCODES = new Set<number>([...Object.values(ADS_OP), ...IF_OPCODES, ...WHILE_OPCODES]);

const scripts = () => loadArchive().list.filter((resource) => resource.type === '.ADS');
const hex = (opcode: number) => `0x${opcode.toString(16).padStart(4, '0')}`;

function frame(bytecode: Uint8Array): { opcodes: number[]; lastOffset: number } {
  const view = new DataView(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength);
  const opcodes: number[] = [];
  let offset = 2;
  let lastOffset = offset;
  while (offset < bytecode.length - 1) {
    const opcode = view.getUint16(offset, true);
    opcodes.push(opcode);
    lastOffset = offset;
    offset += opcode === SECTION_END ? 4 : 2 + 2 * adsArgCount(opcode);
  }
  return { opcodes, lastOffset };
}

describe.skipIf(!hasCorpus)('every ADS resource', () => {
  it('splits into one section per ADS:TAG: entry, with the same tags in the same order', () => {
    // SCRANTIC 1048:04fc
    const wrong = scripts().flatMap(({ name, payload }) => {
      const ads = decodeAds(payload);
      const ours = ads.sections.map(({ tag }) => tag).join(',');
      const listed = ads.tags.map(({ id }) => id).join(',');
      return ours === listed ? [] : [`${name}: sections ${ours}, ADS:TAG: ${listed}`];
    });
    expect(scripts()).toHaveLength(10);
    expect(wrong).toEqual([]);
  });

  it('frames exactly to a closing 0xFFFF in its last word with the original size table', () => {
    // SCRANTIC 1048:0303 1048:04fc
    const wrong = scripts().flatMap(({ name, payload }) => {
      const { bytecode } = decodeAds(payload);
      const { opcodes, lastOffset } = frame(bytecode);
      const last = opcodes.at(-1)!;
      return last === SECTION_END && lastOffset === bytecode.length - 2 ? [] : [`${name}: last instruction ${hex(last)} at ${lastOffset} of ${bytecode.length}`];
    });
    expect(wrong).toEqual([]);
  });

  it('fits in the 80 section slots of the original record', () => {
    // SCRANTIC 1048:04fc
    const counts = scripts().map(({ payload }) => decodeAds(payload).sections.length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(ORIGINAL_SECTION_SLOTS);
  });

  it('uses only opcodes the ADS interpreter knows', () => {
    const unnamed = new Set(scripts().flatMap(({ payload }) => frame(decodeAds(payload).bytecode).opcodes).filter((opcode) => !NAMED_OPCODES.has(opcode)));
    expect([...unnamed].map(hex)).toEqual([]);
  });

  it('keeps its opcode counts', () => {
    const counts: Record<string, number> = {};
    for (const { payload } of scripts()) for (const opcode of frame(decodeAds(payload).bytecode).opcodes) counts[hex(opcode)] = (counts[hex(opcode)] ?? 0) + 1;
    expect(Object.fromEntries(Object.entries(counts).sort())).toMatchSnapshot();
  });

  it('keeps its sections and resources', () => {
    const hashes = Object.fromEntries(
      scripts().map(({ name, payload }) => {
        const { subResources, sections, bytecode } = decodeAds(payload);
        return [name, createHash('sha256').update(JSON.stringify({ subResources, sections })).update(bytecode).digest('hex')];
      }),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe.skipIf(!hasFixture('loaders/ads-arg-counts.tsv'))('ADS framing matches the original SCRANTIC.SCR', () => {
  it('gives every one of the 65,536 opcode words the arg count the original gives', () => {
    // SCRANTIC 1048:0303
    const original = new Map(readFixtureRows('loaders/ads-arg-counts.tsv').map(([opcode, args]) => [parseInt(opcode!, 16), Number(args)]));
    const wrong: string[] = [];
    for (let opcode = 0; opcode <= 0xffff; opcode++) {
      const expected = original.get(opcode) ?? 0;
      if (adsArgCount(opcode) !== expected) wrong.push(`${hex(opcode)}: ours ${adsArgCount(opcode)}, original ${expected}`);
    }
    expect(original.size).toBe(34);
    expect(wrong).toEqual([]);
  });
});
