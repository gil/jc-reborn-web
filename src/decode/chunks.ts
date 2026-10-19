const CONTAINER_FLAG = 0x80000000;
const SIZE_MASK = 0x7fffffff;
const TAG_LENGTH = 4;

export interface Chunk {
  path: string;
  bodyOffset: number;
  size: number;
  container: boolean;
}

export function walkChunks(payload: Uint8Array, start = 0, end = payload.length, prefix = ''): Chunk[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const chunks: Chunk[] = [];
  let pos = start;
  while (pos < end) {
    if (pos + 8 > end) throw new Error(`${end - pos} stray bytes in ${prefix || 'top level'} at ${pos}`);
    const rawSize = view.getUint32(pos + 4, true);
    const chunk: Chunk = {
      path: prefix + String.fromCharCode(...payload.subarray(pos, pos + TAG_LENGTH)),
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

export function findChunk(payload: Uint8Array, path: string): Chunk | undefined {
  if (path.length === 0 || path.length % TAG_LENGTH !== 0) return undefined;
  return walkChunks(payload).find((chunk) => chunk.path === path);
}

export function chunkBody(payload: Uint8Array, path: string): Uint8Array | undefined {
  const chunk = findChunk(payload, path);
  return chunk && payload.subarray(chunk.bodyOffset, chunk.bodyOffset + chunk.size);
}
