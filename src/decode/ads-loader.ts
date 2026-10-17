import { unpackChunk } from '../resource/uncompress.js';
import { indexAdsSections, type AdsSection } from './ads-bytecode.js';
import { chunkBody } from './chunks.js';

export interface AdsSubResource { slot: number; name: string; }
export interface AdsTag { id: number; description: string; }
export interface AdsResource {
  subResources: AdsSubResource[];
  bytecode: Uint8Array;
  sections: AdsSection[];
  tags: AdsTag[];
}

export function decodeAds(payload: Uint8Array): AdsResource {
  const res = chunkBody(payload, 'ADS:RES:');
  const scr = chunkBody(payload, 'ADS:SCR:');
  if (!res || !scr) throw new Error('ADS:RES: or ADS:SCR: missing');
  const bytecode = unpackChunk(scr);
  const tagList = chunkBody(payload, 'ADS:TAG:');
  return {
    subResources: readIdNameList(res).map(({ id, name }) => ({ slot: id, name })),
    bytecode,
    sections: indexAdsSections(bytecode),
    tags: tagList ? readIdNameList(tagList).map(({ id, name }) => ({ id, description: name })) : [],
  };
}

function readIdNameList(body: Uint8Array): { id: number; name: string }[] {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const count = view.getUint16(0, true);
  const list: { id: number; name: string }[] = [];
  let offset = 2;
  for (let i = 0; i < count; i++) {
    const id = view.getUint16(offset, true);
    const end = body.indexOf(0, offset + 2);
    if (end < 0) throw new Error(`id/name list entry ${i} has no end`);
    list.push({ id, name: String.fromCharCode(...body.subarray(offset + 2, end)) });
    offset = end + 1;
  }
  return list;
}
