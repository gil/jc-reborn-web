import type { ParsedArchive } from '../resource/types.js';
import { ascii, chunk, concat, storedBody, words } from './build-chunks.js';

const PAGE_END = 0x0ff0;

export function ttmPayload(...pages: number[][]): Uint8Array {
  const bytecode = words(...pages.flatMap((page) => [...page, PAGE_END]));
  return concat(chunk('VER:', ascii('4.09\0')), chunk('PAG:', words(pages.length)), chunk('TT3:', storedBody(bytecode)));
}

export function adsPayload(ttms: [number, string][], script: number[]): Uint8Array {
  const res = concat(words(ttms.length), ...ttms.map(([id, name]) => concat(words(id), ascii(`${name}\0`))));
  const ads = concat(chunk('RES:', res), chunk('SCR:', storedBody(words(...script))));
  return concat(chunk('VER:', ascii('4.09\0')), chunk('ADS:', ads, true));
}

export function archiveOf(files: Record<string, Uint8Array>): ParsedArchive {
  const list = Object.entries(files).map(([name, payload]) => ({ name, type: name.slice(-4), payload }));
  return { byName: new Map(list.map((resource) => [resource.name, resource])), list };
}
