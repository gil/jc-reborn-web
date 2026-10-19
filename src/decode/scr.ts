import { unpackChunk } from '../resource/uncompress.js';
import { chunkBody } from './chunks.js';
import { unpackNibbles } from './nibbles.js';

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 400;

export interface ScrResource { width: number; height: number; indexed: Uint8Array; }

export function decodeScr(payload: Uint8Array): ScrResource {
  const dim = chunkBody(payload, 'SCR:DIM:');
  const view = dim && new DataView(dim.buffer, dim.byteOffset, dim.byteLength);
  const width = view ? view.getUint16(0, true) : DEFAULT_WIDTH;
  const height = view ? view.getUint16(2, true) : DEFAULT_HEIGHT;
  const bin = chunkBody(payload, 'SCR:BIN:');
  if (!bin) throw new Error('SCR:BIN: missing');
  return { width, height, indexed: unpackNibbles(unpackChunk(bin), width * height) };
}
