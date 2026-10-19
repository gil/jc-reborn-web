import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OP, TTM_OPCODE_NAMES } from '../ttm/opcodes.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { readTtmInstruction, type TtmInstruction } from './ttm-bytecode.js';
import { decodeTtm } from './ttm-loader.js';

const scripts = () => loadArchive().list.filter((resource) => resource.type === '.TTM');

function instructions(bytecode: Uint8Array): TtmInstruction[] {
  const list: TtmInstruction[] = [];
  for (let offset = 0; offset < bytecode.length; ) {
    const instruction = readTtmInstruction(bytecode, offset);
    list.push(instruction);
    offset = instruction.next;
  }
  return list;
}

const hex = (opcode: number) => `0x${opcode.toString(16).padStart(4, '0')}`;

describe.skipIf(!hasCorpus)('every TTM resource', () => {
  it('frames every script from its first byte exactly to its last', () => {
    // SCRANTIC 1050:04d6
    const wrong = scripts().flatMap(({ name, payload }) => {
      const { bytecode } = decodeTtm(payload);
      try {
        const end = instructions(bytecode).at(-1)?.next ?? 0;
        return end === bytecode.length ? [] : [`${name}: framing ends at ${end} of ${bytecode.length}`];
      } catch (error) {
        return [`${name}: ${(error as Error).message}`];
      }
    });
    expect(scripts()).toHaveLength(41);
    expect(wrong).toEqual([]);
  });

  it('finds every page PAG: announces, one per 0x0FF0', () => {
    // SCRANTIC 1050:0177 1050:04d6
    const wrong = scripts().flatMap(({ name, payload }) => {
      const ttm = decodeTtm(payload);
      const updates = instructions(ttm.bytecode).filter(({ opcode }) => opcode === OP.UPDATE).length;
      return ttm.pageOffsets.length === ttm.pageCount && updates === ttm.pageCount ? [] : [`${name}: PAG ${ttm.pageCount}, ${ttm.pageOffsets.length} pages, ${updates} updates`];
    });
    expect(wrong).toEqual([]);
  });

  it('uses only opcodes our TTM opcode table names', () => {
    const unnamed = new Set(scripts().flatMap(({ payload }) => instructions(decodeTtm(payload).bytecode).map(({ opcode }) => opcode)).filter((opcode) => !(opcode in TTM_OPCODE_NAMES)));
    expect([...unnamed].map(hex)).toEqual([]);
  });

  it('keeps its opcode counts', () => {
    const counts: Record<string, number> = {};
    for (const { payload } of scripts()) for (const { opcode } of instructions(decodeTtm(payload).bytecode)) counts[hex(opcode)] = (counts[hex(opcode)] ?? 0) + 1;
    expect(Object.fromEntries(Object.entries(counts).sort())).toMatchSnapshot();
  });

  it('keeps its page index', () => {
    const hashes = Object.fromEntries(
      scripts().map(({ name, payload }) => {
        const { pageCount, pageOffsets, tags } = decodeTtm(payload);
        return [name, createHash('sha256').update(JSON.stringify({ pageCount, pageOffsets, tags })).digest('hex')];
      }),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe.skipIf(!hasFixture('loaders/ttm.tsv'))('TTM loading matches the original SCRANTIC.SCR', () => {
  it('builds the same page count, page offsets, and tags as the original loader', () => {
    // SCRANTIC 1050:0177 1050:04d6 1050:042a
    const archive = loadArchive();
    const rows = readFixtureRows('loaders/ttm.tsv');
    const wrong = rows.flatMap(([name, status, pageCount, pageOffsets, tags]) => {
      const ttm = decodeTtm(archive.byName.get(name!)!.payload);
      const ours = [ttm.pageCount, ttm.pageOffsets.join(','), ttm.tags.map(({ id, page }) => `${id}@${page}`).join(',')].join(' ');
      const original = [pageCount, pageOffsets, tags ?? ''].join(' ');
      return status === '1' && ours === original ? [] : [`${name}: status ${status}; ours ${ours}; original ${original}`];
    });
    expect(rows).toHaveLength(41);
    expect(wrong).toEqual([]);
  });
});
