import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHUNKED_TYPES, COMPRESSED_CHUNKS, FIXTURES_DIR, hasCorpus, loadArchive, walkChunks } from '../testing/corpus.js';
import { unpackChunk } from './uncompress.js';

const ORIGINAL_DIR = FIXTURES_DIR + 'decompressed/';
const hasOriginal = hasCorpus && existsSync(ORIGINAL_DIR + 'index.tsv');

function compressedChunks() {
  return loadArchive()
    .list.filter((resource) => CHUNKED_TYPES.has(resource.type))
    .flatMap((resource) =>
      walkChunks(resource.payload)
        .filter((chunk) => COMPRESSED_CHUNKS.has(chunk.path))
        .map((chunk) => ({
          key: `${resource.name} ${chunk.path}`,
          body: resource.payload.subarray(chunk.bodyOffset, chunk.bodyOffset + chunk.size),
        })),
    );
}

function headerSize(body: Uint8Array): number {
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1, true);
}

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

describe.skipIf(!hasCorpus)('decompression over the whole corpus', () => {
  it('finds every compressed chunk', () => {
    expect(compressedChunks()).toHaveLength(180);
  });

  it('decompresses every chunk to the size in its header', () => {
    const wrong = compressedChunks()
      .map(({ key, body }) => ({ key, size: headerSize(body), got: unpackChunk(body).length }))
      .filter(({ size, got }) => size !== got);
    expect(wrong).toEqual([]);
  });

  it('keeps the decoded bytes of every chunk', () => {
    const hashes = Object.fromEntries(
      compressedChunks().map(({ key, body }) => [key, createHash('sha256').update(unpackChunk(body)).digest('hex')]),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe.skipIf(!hasOriginal)('decompression matches the original SCRANTIC.SCR', () => {
  it('produces the same bytes as the original stream reader for every chunk', () => {
    // SCRANTIC 1028:0615 1028:0a0d
    const [, ...rows] = readFileSync(ORIGINAL_DIR + 'index.tsv', 'utf8').trimEnd().split('\n');
    const ours = new Map(compressedChunks().map(({ key, body }) => [key, unpackChunk(body)]));
    const mismatches = rows.flatMap((row) => {
      const [resource, chunk, , , , , file] = row.split('\t');
      const key = `${resource} ${chunk}`;
      const original = new Uint8Array(readFileSync(ORIGINAL_DIR + file));
      const mine = ours.get(key) ?? new Uint8Array();
      const at = firstDifference(mine, original);
      return at < 0 ? [] : [`${key}: first difference at byte ${at} (ours ${mine.length} bytes, original ${original.length})`];
    });
    expect(rows).toHaveLength(180);
    expect(mismatches).toEqual([]);
  });
});
