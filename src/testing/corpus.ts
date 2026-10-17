/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexArchive } from '../resource/resource-archive.js';
import { parseMap } from '../resource/resource-map.js';
import type { ParsedArchive } from '../resource/types.js';

export { walkChunks, type Chunk } from '../decode/chunks.js';

export const DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url));
export const FIXTURES_DIR = fileURLToPath(new URL('../../re/fixtures/', import.meta.url));
export const hasCorpus = existsSync(DATA_DIR + 'RESOURCE.MAP') && existsSync(DATA_DIR + 'RESOURCE.001');

export const CHUNKED_TYPES = new Set(['.ADS', '.BMP', '.PAL', '.SCR', '.TTM']);
export const COMPRESSED_CHUNKS = new Set(['BMP:BIN:', 'BMP:VGA:', 'SCR:BIN:', 'ADS:SCR:', 'TT3:']);

export function readDataFile(name: string): ArrayBuffer {
  return new Uint8Array(readFileSync(DATA_DIR + name)).buffer;
}

export function loadArchive(): ParsedArchive {
  return indexArchive(parseMap(readDataFile('RESOURCE.MAP')), readDataFile('RESOURCE.001'));
}

export function hasFixture(path: string): boolean {
  return hasCorpus && existsSync(FIXTURES_DIR + path);
}

export function readFixtureRows(path: string): string[][] {
  const [, ...rows] = readFileSync(FIXTURES_DIR + path, 'utf8').trimEnd().split('\n');
  return rows.map((row) => row.split('\t'));
}

export function readFixtureBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURES_DIR + path));
}
