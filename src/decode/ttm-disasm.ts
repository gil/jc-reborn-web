export function disasmTtm(bytecode: Uint8Array, opcodeNames?: Record<number, string>): string {
  const dv = new DataView(bytecode.buffer, bytecode.byteOffset);
  const lines: string[] = [];
  let p = 0;
  while (p < bytecode.length) {
    const offset = p;
    const op = dv.getUint16(p, true); p += 2;
    const argCount = op & 0x000f;
    const args: number[] = [];
    let str: string | undefined;
    if (argCount === 0x0f) {
      const sb: number[] = [];
      while (p < bytecode.length) {
        const b = dv.getUint8(p++); if (b === 0) break; sb.push(b);
      }
      if (p & 1) p++;
      str = new TextDecoder('latin1').decode(new Uint8Array(sb));
    } else {
      for (let i = 0; i < argCount; i++) { args.push(dv.getUint16(p, true)); p += 2; }
    }
    const name = opcodeNames?.[op] ?? '???';
    let line = `${offset.toString(16).padStart(6, '0')}  ${op.toString(16).padStart(4, '0')} ${name}`;
    if (args.length) line += ` ${args.join(' ')}`;
    if (str !== undefined) line += ` "${str}"`;
    lines.push(line);
  }
  return lines.join('\n');
}
