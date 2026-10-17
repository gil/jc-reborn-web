const END_OF_INPUT = -1;
const CLEAR_CODE = 256;
const FIRST_FREE_CODE = 257;
const TABLE_SIZE = 4096;
const MIN_WIDTH = 9;
const MAX_WIDTH = 12;

export function unpackChunk(body: Uint8Array): Uint8Array {
  const size = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1, true);
  return uncompress(body[0]!, body.subarray(5), size);
}

export function uncompress(method: number, input: Uint8Array, outSize: number): Uint8Array {
  if (method === 0) return input.slice(0, outSize);
  if (method === 1) return uncompressRle(input, outSize);
  if (method === 2) return uncompressLzw(input, outSize);
  throw new Error(`unknown compression method ${method}`);
}

function uncompressRle(input: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let inOff = 0;
  let outOff = 0;
  while (outOff < outSize && inOff < input.length) {
    const control = input[inOff++]!;
    const count = control & 0x7f;
    if (control & 0x80) {
      const value = inOff < input.length ? input[inOff++]! : 0xff;
      for (let i = 0; i < count && outOff < outSize; i++) out[outOff++] = value;
    } else {
      for (let i = 0; i < count && outOff < outSize && inOff < input.length; i++) out[outOff++] = input[inOff++]!;
    }
  }
  return out.subarray(0, outOff);
}

function uncompressLzw(input: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  const prefix = new Uint16Array(TABLE_SIZE);
  const suffix = new Uint8Array(TABLE_SIZE);
  for (let i = 0; i < 256; i++) suffix[i] = i;
  const stack = new Uint8Array(TABLE_SIZE);

  let inOff = 0;
  let width = MIN_WIDTH;
  let maxCode = (1 << width) - 1;
  let freeCode = FIRST_FREE_CODE;
  let clearPending = false;
  // The original keeps one group buffer for all reads, so a 1-byte last group reuses the previous group's bytes.
  const group = new Uint8Array(MAX_WIDTH + 1);
  let groupBits = 0;
  let bitOff = 0;

  const readCode = (): number => {
    if (clearPending || bitOff >= groupBits || freeCode > maxCode) {
      if (freeCode > maxCode) {
        width++;
        maxCode = width === MAX_WIDTH ? TABLE_SIZE : (1 << width) - 1;
      }
      if (clearPending) {
        width = MIN_WIDTH;
        maxCode = (1 << width) - 1;
        clearPending = false;
      }
      const bytes = input.subarray(inOff, inOff + width);
      if (bytes.length === 0) return END_OF_INPUT;
      group.set(bytes);
      inOff += bytes.length;
      bitOff = 0;
      groupBits = bytes.length * 8 - (width - 1);
    }
    let code = 0;
    for (let i = 0; i < width; i++) {
      const bit = bitOff + i;
      if (group[bit >> 3]! & (1 << (bit & 7))) code |= 1 << i;
    }
    bitOff += width;
    return code;
  };

  let outOff = 0;
  let oldCode = readCode();
  let firstByte = oldCode & 0xff;
  if (outOff < outSize) out[outOff++] = firstByte;

  for (;;) {
    let code = readCode();
    if (code === END_OF_INPUT) break;
    if (code === CLEAR_CODE) {
      clearPending = true;
      freeCode = CLEAR_CODE;
      code = readCode();
      if (code === END_OF_INPUT) break;
    }

    const inCode = code;
    let sp = 0;
    if (code >= freeCode) {
      stack[sp++] = firstByte;
      code = oldCode;
    }
    while (code >= 256) {
      if (sp === stack.length) throw new Error('LZW prefix chain loops');
      stack[sp++] = suffix[code]!;
      code = prefix[code]!;
    }
    firstByte = suffix[code]!;
    stack[sp++] = firstByte;

    while (sp > 0) {
      if (outOff >= outSize) return out;
      out[outOff++] = stack[--sp]!;
    }

    if (freeCode < TABLE_SIZE) {
      prefix[freeCode] = oldCode;
      suffix[freeCode] = firstByte;
      freeCode++;
    }
    oldCode = inCode;
  }
  return out.subarray(0, outOff);
}
