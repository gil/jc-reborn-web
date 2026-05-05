export class BinaryReader {
  readonly view: DataView;
  private offset: number;
  constructor(buf: ArrayBuffer | SharedArrayBuffer, offset = 0) {
    this.view = new DataView(buf);
    this.offset = offset;
  }
  get pos(): number { return this.offset; }
  set pos(v: number) { this.offset = v; }
  get remaining(): number { return this.view.byteLength - this.offset; }

  u8(): number { return this.view.getUint8(this.offset++); }
  u16(): number { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, n);
    this.offset += n;
    return new Uint8Array(out); // copy so callers can keep it past pos changes
  }
  fixedString(n: number): string {
    const raw = this.bytes(n);
    let end = raw.indexOf(0);
    if (end < 0) end = n;
    return new TextDecoder('latin1').decode(raw.subarray(0, end));
  }
  expect(magic: string): void {
    const got = new TextDecoder('latin1').decode(this.bytes(magic.length));
    if (got !== magic) throw new Error(`expected ${magic} got ${got} @${this.offset - magic.length}`);
  }
}
