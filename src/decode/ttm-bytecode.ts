const MAX_WORD_ARGS = 7;
const STRING_ARG = 0x0f;
const WORD_PAIR_LIST_OPCODES = new Set([0xaf1f, 0xaf2f]);

export interface TtmInstruction {
  offset: number;
  opcode: number;
  args: number[];
  text?: string;
  next: number;
}

export function readTtmInstruction(bytecode: Uint8Array, offset: number): TtmInstruction {
  const view = new DataView(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength);
  const opcode = view.getUint16(offset, true);
  const argCode = opcode & 0x0f;
  let next = offset + 2;
  const readWords = (count: number): number[] => {
    const values = Array.from({ length: count }, (_, i) => view.getUint16(next + 2 * i, true));
    next += 2 * count;
    return values;
  };
  if (argCode <= MAX_WORD_ARGS) return { offset, opcode, args: readWords(argCode), next };
  const where = `TTM opcode 0x${opcode.toString(16).padStart(4, '0')} at ${offset}`;
  if (argCode !== STRING_ARG) throw new Error(`${where}: arg code ${argCode} is invalid`);
  if (WORD_PAIR_LIST_OPCODES.has(opcode)) {
    const [pairs] = readWords(1);
    return { offset, opcode, args: [pairs!, ...readWords(pairs! * 2)], next };
  }
  const end = bytecode.indexOf(0, next);
  if (end < 0) throw new Error(`${where}: string runs past the end`);
  const text = String.fromCharCode(...bytecode.subarray(next, end));
  const field = end + 1 - next;
  return { offset, opcode, args: [], text, next: next + field + (field & 1) };
}
