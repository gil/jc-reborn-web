const CONTAINER_FLAG = 0x80000000;

export function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

export function words(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint16(i * 2, value, true));
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function chunk(tag: string, body: Uint8Array, container = false): Uint8Array {
  const header = new Uint8Array(8);
  header.set(ascii(tag));
  new DataView(header.buffer).setUint32(4, (body.length | (container ? CONTAINER_FLAG : 0)) >>> 0, true);
  return concat(header, body);
}

export function storedBody(data: Uint8Array): Uint8Array {
  const header = new Uint8Array(5);
  new DataView(header.buffer).setUint32(1, data.length, true);
  return concat(header, data);
}
