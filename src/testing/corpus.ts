/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexArchive } from '../resource/resource-archive.js';
import { parseMap } from '../resource/resource-map.js';
import type { ParsedArchive } from '../resource/types.js';

export const DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url));
export const FIXTURES_DIR = fileURLToPath(new URL('../../re/fixtures/', import.meta.url));
export const hasCorpus = existsSync(DATA_DIR + 'RESOURCE.MAP') && existsSync(DATA_DIR + 'RESOURCE.001');

export const CHUNKED_TYPES = new Set(['.ADS', '.BMP', '.PAL', '.SCR', '.TTM']);
export const COMPRESSED_CHUNKS = new Set(['BMP:BIN:', 'BMP:VGA:', 'SCR:BIN:', 'ADS:SCR:', 'TT3:']);
const CONTAINER_FLAG = 0x80000000;
const SIZE_MASK = 0x7fffffff;

export interface Chunk {
  path: string;
  bodyOffset: number;
  size: number;
  container: boolean;
}

export function readDataFile(name: string): ArrayBuffer {
  return new Uint8Array(readFileSync(DATA_DIR + name)).buffer;
}

export function loadArchive(): ParsedArchive {
  return indexArchive(parseMap(readDataFile('RESOURCE.MAP')), readDataFile('RESOURCE.001'));
}

export function walkChunks(payload: Uint8Array, start = 0, end = payload.length, prefix = ''): Chunk[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const chunks: Chunk[] = [];
  let pos = start;
  while (pos < end) {
    if (pos + 8 > end) throw new Error(`${end - pos} stray bytes in ${prefix || 'top level'} at ${pos}`);
    const rawSize = view.getUint32(pos + 4, true);
    const chunk: Chunk = {
      path: prefix + String.fromCharCode(...payload.subarray(pos, pos + 4)),
      bodyOffset: pos + 8,
      size: rawSize & SIZE_MASK,
      container: (rawSize & CONTAINER_FLAG) !== 0,
    };
    if (chunk.bodyOffset + chunk.size > end) throw new Error(`${chunk.path} at ${pos} overruns its parent`);
    chunks.push(chunk);
    if (chunk.container) chunks.push(...walkChunks(payload, chunk.bodyOffset, chunk.bodyOffset + chunk.size, chunk.path));
    pos = chunk.bodyOffset + chunk.size;
  }
  return chunks;
}
