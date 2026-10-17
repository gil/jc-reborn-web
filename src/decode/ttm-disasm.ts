import { readTtmInstruction } from './ttm-bytecode.js';

export function disasmTtm(bytecode: Uint8Array, opcodeNames?: Record<number, string>): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytecode.length; ) {
    const { opcode, args, text, next } = readTtmInstruction(bytecode, offset);
    let line = `${offset.toString(16).padStart(6, '0')}  ${opcode.toString(16).padStart(4, '0')} ${opcodeNames?.[opcode] ?? '???'}`;
    if (args.length) line += ` ${args.map((arg) => (arg << 16) >> 16).join(' ')}`;
    if (text !== undefined) line += ` "${text}"`;
    lines.push(line);
    offset = next;
  }
  return lines.join('\n');
}
