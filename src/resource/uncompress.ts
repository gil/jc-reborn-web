export function uncompress(method: number, input: Uint8Array, outSize: number): Uint8Array {
  if (method === 1) return uncompressRle(input, outSize);
  if (method === 2) return uncompressLzw(input, outSize);
  throw new Error(`unknown compression method ${method}`);
}

function uncompressRle(input: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let inOff = 0, outOff = 0;
  while (outOff < outSize) {
    const ctrl = input[inOff++]!;
    if ((ctrl & 0x80) === 0x80) {
      const len = ctrl & 0x7f;
      const b = input[inOff++]!;
      for (let i = 0; i < len; i++) out[outOff++] = b;
    } else {
      for (let i = 0; i < ctrl; i++) out[outOff++] = input[inOff++]!;
    }
  }
  return out;
}

// LSB-first bit reader matching uncompress.c:54-74
function uncompressLzw(input: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  const prefix = new Uint16Array(4096);
  const append = new Uint8Array(4096);
  const stack = new Uint8Array(4096);

  let inOff = 0;
  let curByte = inOff < input.length ? input[inOff++]! : 0;
  let nextBit = 0;
  let nBits = 9;
  let bitpos = 0;
  let freeEntry = 257;
  let outOff = 0;

  const getBits = (n: number): number => {
    let x = 0;
    for (let i = 0; i < n; i++) {
      if (curByte & (1 << nextBit)) x |= 1 << i;
      nextBit++;
      if (nextBit > 7) {
        curByte = inOff < input.length ? input[inOff++]! : 0;
        nextBit = 0;
      }
    }
    return x;
  };

  let oldcode = getBits(nBits);
  let lastbyte = oldcode;
  out[outOff++] = oldcode & 0xff;

  while (inOff <= input.length) {
    const newcode = getBits(nBits);
    bitpos += nBits;

    if (newcode === 256) {
      const nbits3 = nBits << 3;
      const nskip = (nbits3 - ((bitpos - 1) % nbits3)) - 1;
      getBits(nskip);
      nBits = 9;
      freeEntry = 256;
      bitpos = 0;
      continue;
    }

    let code = newcode;
    let stackPtr = 0;

    if (code >= freeEntry) {
      stack[stackPtr++] = lastbyte & 0xff;
      code = oldcode;
    }
    while (code > 255) {
      if (code > 4095) break;
      stack[stackPtr++] = append[code]!;
      code = prefix[code]!;
    }
    stack[stackPtr++] = code & 0xff;
    lastbyte = code;

    while (stackPtr > 0) {
      stackPtr--;
      if (outOff >= outSize) return out;
      out[outOff++] = stack[stackPtr]!;
    }

    if (freeEntry < 4096) {
      prefix[freeEntry] = oldcode;
      append[freeEntry] = lastbyte & 0xff;
      freeEntry++;
      if (freeEntry >= (1 << nBits) && nBits < 12) {
        nBits++;
        bitpos = 0;
      }
    }
    oldcode = newcode;
  }
  return out;
}
