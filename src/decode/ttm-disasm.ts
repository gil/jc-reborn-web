import { BinaryReader } from '../io/binary-reader.js';

const STRING_OPCODES = new Set([0xf01f, 0xf02f, 0xf05f]);

export function disasmTtm(bytecode: Uint8Array, opcodeNames?: Record<number, string>): string {
  const r = new BinaryReader(bytecode.buffer, bytecode.byteOffset);
  const lines: string[] = [];
  while (r.pos < bytecode.length) {
    const offset = r.pos;
    if ((r.pos & 1) !== 0) r.u8(); // align
    if (r.pos >= bytecode.length) break;
    const op = r.u16();
    const argCount = op & 0x000f;
    const args: number[] = [];
    for (let i = 0; i < argCount; i++) args.push(r.u16());
    const name = opcodeNames?.[op] ?? '???';
    let line = `${offset.toString(16).padStart(6, '0')}  ${op.toString(16).padStart(4, '0')} ${name} ${args.join(' ')}`;
    if (STRING_OPCODES.has(op)) {
      const sb: number[] = [];
      while (r.pos < bytecode.length) {
        const b = r.u8();
        if (b === 0) break;
        sb.push(b);
      }
      if (r.pos & 1) r.u8(); // pad to even
      line += ` "${new TextDecoder('latin1').decode(new Uint8Array(sb))}"`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}
