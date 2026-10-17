import { unpackChunk } from '../resource/uncompress.js';
import { OP } from '../ttm/opcodes.js';
import { chunkBody } from './chunks.js';
import { readTtmInstruction } from './ttm-bytecode.js';

const DEFAULT_PAGE_COUNT = 330;

export interface TtmTag { id: number; page: number; }
export interface TtmResource {
  pageCount: number;
  bytecode: Uint8Array;
  pageOffsets: number[];
  tags: TtmTag[];
}

export function decodeTtm(payload: Uint8Array): TtmResource {
  const pag = chunkBody(payload, 'PAG:');
  const pageCount = pag ? new DataView(pag.buffer, pag.byteOffset, pag.byteLength).getUint16(0, true) : DEFAULT_PAGE_COUNT;
  const tt3 = chunkBody(payload, 'TT3:');
  if (!tt3) throw new Error('TT3: missing');
  const bytecode = unpackChunk(tt3);
  return { pageCount, bytecode, ...indexPages(bytecode, pageCount) };
}

function indexPages(bytecode: Uint8Array, pageCount: number): Pick<TtmResource, 'pageOffsets' | 'tags'> {
  const pageOffsets: number[] = [];
  const tags: TtmTag[] = [];
  let offset = 0;
  for (let page = 0; page < pageCount; page++) {
    pageOffsets.push(offset);
    for (;;) {
      if (offset >= bytecode.length - 1) return { pageOffsets, tags };
      const instruction = readTtmInstruction(bytecode, offset);
      offset = instruction.next;
      if (instruction.opcode === OP.UPDATE) break;
      if (instruction.opcode === OP.TAG) tags.push({ id: instruction.args[0]!, page });
    }
  }
  return { pageOffsets, tags };
}
