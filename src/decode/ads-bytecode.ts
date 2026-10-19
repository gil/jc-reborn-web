const SECTION_END = 0xffff;
const ARG_COUNTS = new Map<number, number>([
  [0xf000, 0], [0xf010, 1], [0xf200, 1], [0xf210, 1],
  [0x1010, 2], [0x1020, 2], [0x1030, 2], [0x1040, 2], [0x1050, 2], [0x1060, 2], [0x1070, 2], [0x1080, 1],
  [0x1310, 2], [0x1320, 2], [0x1330, 2], [0x1340, 2], [0x1350, 2], [0x1360, 2], [0x1370, 2],
  [0x1380, 1], [0x1390, 1], [0x13a0, 1], [0x13a1, 1], [0x13b0, 1], [0x13b1, 1], [0x13c0, 1], [0x13c1, 1],
  [0x2000, 4], [0x2005, 4], [0x2010, 3], [0x2015, 3], [0x2020, 3],
  [0x3020, 1],
  [0x4000, 3], [0x4010, 3],
]);

export function adsArgCount(opcode: number): number {
  return ARG_COUNTS.get(opcode) ?? 0;
}

export interface AdsSection { tag: number; offset: number; }

export function indexAdsSections(bytecode: Uint8Array): AdsSection[] {
  const view = new DataView(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength);
  const word = (offset: number) => view.getUint16(offset, true);
  const sections: AdsSection[] = [];
  let sectionStart = 2;
  let offset = sectionStart;
  while (offset < bytecode.length - 1) {
    const opcode = word(offset);
    if (opcode === SECTION_END) {
      sections.push({ tag: word(sectionStart - 2), offset: sectionStart });
      offset += 4;
      sectionStart = offset;
    } else {
      offset += 2 + 2 * adsArgCount(opcode);
    }
  }
  return sections;
}
