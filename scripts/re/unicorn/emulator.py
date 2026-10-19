import struct
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_16, Uc
from unicorn.x86_const import (
    UC_X86_REG_AX,
    UC_X86_REG_BP,
    UC_X86_REG_BX,
    UC_X86_REG_CS,
    UC_X86_REG_CX,
    UC_X86_REG_DI,
    UC_X86_REG_DS,
    UC_X86_REG_DX,
    UC_X86_REG_ES,
    UC_X86_REG_FLAGS,
    UC_X86_REG_IP,
    UC_X86_REG_SI,
    UC_X86_REG_SP,
    UC_X86_REG_SS,
)

from ne_image import (
    MOVABLE_SEGMENT,
    SRC_FAR_ADDR,
    SRC_LOBYTE,
    SRC_OFFSET,
    SRC_SELECTOR,
    ImportTarget,
    InternalTarget,
    NeImage,
    Relocation,
    Segment,
)

MEMORY_SIZE = 0x100000
FIRST_PARAGRAPH = 0x0100
AUTO_DATA_SIZE = 0x10000
STUB_SEGMENT_SIZE = 0x1000
SENTINEL_OFFSET = 0
INITIAL_SP = 0xFFFE
DEFAULT_INSTRUCTION_LIMIT = 50_000_000
RETF = 0xCB
JMP_FAR = 0xEA
NEAR_HEAP_END = 0xE000

REAL_MODE_CONSTANTS = {
    ImportTarget("KERNEL", 113): 12,
    ImportTarget("KERNEL", 114): 0x1000,
}

REGISTERS = {
    "ax": UC_X86_REG_AX,
    "bx": UC_X86_REG_BX,
    "cx": UC_X86_REG_CX,
    "dx": UC_X86_REG_DX,
    "si": UC_X86_REG_SI,
    "di": UC_X86_REG_DI,
    "bp": UC_X86_REG_BP,
    "sp": UC_X86_REG_SP,
    "cs": UC_X86_REG_CS,
    "ds": UC_X86_REG_DS,
    "es": UC_X86_REG_ES,
    "ss": UC_X86_REG_SS,
    "ip": UC_X86_REG_IP,
    "flags": UC_X86_REG_FLAGS,
}


class UnstubbedImport(Exception):
    def __init__(self, target: ImportTarget):
        super().__init__(f"no stub for {target.module} ordinal {target.ordinal}")
        self.target = target


class EmulationLimit(Exception):
    pass


@dataclass
class Stub:
    handler: Callable[["Emulator"], dict[str, int] | None]
    arg_bytes: int


StubKey = ImportTarget | str

def ghidra_selector_to_segment(selector: int) -> int:
    return (selector - 0x1000) // 8 + 1


class Emulator:
    def __init__(self, image: NeImage):
        self.image = image
        self.uc = Uc(UC_ARCH_X86, UC_MODE_16)
        self.uc.mem_map(0, MEMORY_SIZE)
        self.paragraphs: dict[int, int] = {}
        self.fixup_sites: list[tuple[int, int, Relocation]] = []
        self.stubs: dict[StubKey, Stub] = {}
        self._stub_offsets: dict[StubKey, int] = {}
        self._stub_keys_by_offset: dict[int, StubKey] = {}

        paragraph = FIRST_PARAGRAPH
        for segment in image.segments:
            self.paragraphs[segment.index] = paragraph
            self.uc.mem_write(paragraph * 16, segment.data)
            size = AUTO_DATA_SIZE if segment.index == image.auto_data_segment else max(len(segment.data), segment.min_alloc)
            paragraph += (size + 15) // 16
        auto_data = next(s for s in image.segments if s.index == image.auto_data_segment)
        self._near_heap = (max(len(auto_data.data), auto_data.min_alloc) + 15) & ~15
        self.stub_paragraph = paragraph
        self._heap_paragraph = paragraph + STUB_SEGMENT_SIZE // 16

        self.uc.mem_write(self.stub_paragraph * 16, bytes([RETF]) * STUB_SEGMENT_SIZE)
        for segment in image.segments:
            self._apply_relocations(segment)
        stub_base = self.stub_paragraph * 16
        self.uc.hook_add(UC_HOOK_CODE, self._on_stub, begin=stub_base, end=stub_base + STUB_SEGMENT_SIZE - 1)

    def far(self, address: str) -> tuple[int, int]:
        selector, offset = (int(part, 16) for part in address.split(":"))
        return self.paragraphs[ghidra_selector_to_segment(selector)], offset

    def import_address(self, module: str, ordinal: int) -> tuple[int, int]:
        return self.stub_paragraph, self._stub_offset(ImportTarget(module, ordinal))

    def add_stub(self, module: str, ordinal: int, handler: Callable[["Emulator"], dict[str, int] | None], arg_bytes: int):
        self.stubs[ImportTarget(module, ordinal)] = Stub(handler, arg_bytes)

    def replace_function(self, address: str, handler: Callable[["Emulator"], dict[str, int] | None], arg_bytes: int = 0):
        offset = self._stub_offset(address)
        self.stubs[address] = Stub(handler, arg_bytes)
        segment, ip = self.far(address)
        self.write(segment, ip, struct.pack("<BHH", JMP_FAR, offset, self.stub_paragraph))

    def arg(self, index: int) -> int:
        return struct.unpack("<H", self.read(self.reg("ss"), self.reg("sp") + 4 + 2 * index, 2))[0]

    @property
    def data_segment(self) -> int:
        return self.paragraphs[self.image.auto_data_segment]

    def near_alloc(self, size: int) -> int:
        offset = self._near_heap
        if offset + size > NEAR_HEAP_END:
            raise MemoryError(f"near heap exhausted allocating {size} bytes")
        self._near_heap = (offset + size + 1) & ~1
        return offset

    def alloc(self, size: int) -> tuple[int, int]:
        paragraph = self._heap_paragraph
        self._heap_paragraph += (size + 15) // 16
        if self._heap_paragraph * 16 > MEMORY_SIZE:
            raise MemoryError(f"emulator heap exhausted allocating {size} bytes")
        return paragraph, 0

    def read(self, segment: int, offset: int, size: int) -> bytes:
        return bytes(self.uc.mem_read(segment * 16 + offset, size))

    def write(self, segment: int, offset: int, data: bytes):
        self.uc.mem_write(segment * 16 + offset, data)

    def reg(self, name: str) -> int:
        return self.uc.reg_read(REGISTERS[name])

    def set_regs(self, **values: int):
        for name, value in values.items():
            self.uc.reg_write(REGISTERS[name], value & 0xFFFF)

    def call_far(
        self,
        address: str | tuple[int, int],
        regs: dict[str, int] | None = None,
        stack_words: Sequence[int] = (),
        instruction_limit: int = DEFAULT_INSTRUCTION_LIMIT,
    ) -> dict[str, int]:
        code_segment, ip = self.far(address) if isinstance(address, str) else address
        data_segment = self.data_segment
        self.set_regs(ds=data_segment, es=data_segment, ss=data_segment, sp=INITIAL_SP, bp=0)
        self.set_regs(**(regs or {}))
        for word in [*stack_words, self.stub_paragraph, SENTINEL_OFFSET]:
            self._push(word)
        self.set_regs(cs=code_segment)
        sentinel = self.stub_paragraph * 16 + SENTINEL_OFFSET
        self.uc.emu_start(code_segment * 16 + ip, sentinel, count=instruction_limit)
        if self._linear_pc() != sentinel:
            raise EmulationLimit(f"stopped at {self.reg('cs'):04x}:{self.reg('ip'):04x} without returning")
        return {name: self.reg(name) for name in REGISTERS}

    def _push(self, word: int):
        sp = (self.reg("sp") - 2) & 0xFFFF
        self.set_regs(sp=sp)
        self.write(self.reg("ss"), sp, struct.pack("<H", word & 0xFFFF))

    def _linear_pc(self) -> int:
        return self.reg("cs") * 16 + self.reg("ip")

    def _stub_offset(self, key: StubKey) -> int:
        if key not in self._stub_offsets:
            offset = 2 + 2 * len(self._stub_offsets)
            if offset >= STUB_SEGMENT_SIZE:
                raise MemoryError("stub segment full")
            self._stub_offsets[key] = offset
            self._stub_keys_by_offset[offset] = key
        return self._stub_offsets[key]

    def _on_stub(self, uc, address, size, user_data):
        offset = address - self.stub_paragraph * 16
        if offset == SENTINEL_OFFSET:
            return
        key = self._stub_keys_by_offset[offset]
        stub = self.stubs.get(key)
        if stub is None:
            raise UnstubbedImport(key)
        self.set_regs(**(stub.handler(self) or {}))
        ss, sp = self.reg("ss"), self.reg("sp")
        return_address = self.read(ss, sp, 4)
        sp = (sp + stub.arg_bytes) & 0xFFFF
        self.write(ss, sp, return_address)
        self.set_regs(sp=sp)

    def _apply_relocations(self, segment: Segment):
        base = self.paragraphs[segment.index] * 16
        for relocation in segment.relocations:
            value = self._resolve(relocation.target)
            sites = [relocation.offset] if relocation.additive else self._chain(base, len(segment.data), relocation.offset)
            for site in sites:
                self._patch(base + site, relocation, value)
                self.fixup_sites.append((segment.index, site, relocation))

    def _chain(self, base: int, length: int, head: int) -> list[int]:
        sites = []
        site = head
        while site != 0xFFFF:
            if site + 2 > length or site in sites:
                raise ValueError(f"broken relocation chain at offset {site:#06x}")
            sites.append(site)
            site = struct.unpack("<H", self.uc.mem_read(base + site, 2))[0]
        return sites

    def _resolve(self, target: InternalTarget | ImportTarget) -> int | tuple[int, int]:
        if isinstance(target, ImportTarget):
            if target in REAL_MODE_CONSTANTS:
                return REAL_MODE_CONSTANTS[target]
            return self.stub_paragraph, self._stub_offset(target)
        if target.segment == MOVABLE_SEGMENT:
            target = self.image.entry_points[target.offset]
        return self.paragraphs[target.segment], target.offset

    def _patch(self, address: int, relocation: Relocation, value: int | tuple[int, int]):
        if isinstance(value, int):
            if relocation.source_type not in (SRC_OFFSET, SRC_SELECTOR):
                raise NotImplementedError(f"constant import with source type {relocation.source_type}")
            self._write_word(address, value, relocation.additive)
            return
        paragraph, offset = value
        if relocation.source_type == SRC_FAR_ADDR:
            self._write_word(address, offset, relocation.additive)
            self._write_word(address + 2, paragraph, False)
        elif relocation.source_type == SRC_SELECTOR:
            self._write_word(address, paragraph, False)
        elif relocation.source_type == SRC_OFFSET:
            self._write_word(address, offset, relocation.additive)
        elif relocation.source_type == SRC_LOBYTE:
            current = self.uc.mem_read(address, 1)[0] if relocation.additive else 0
            self.uc.mem_write(address, bytes([(current + offset) & 0xFF]))
        else:
            raise NotImplementedError(f"relocation source type {relocation.source_type}")

    def _write_word(self, address: int, value: int, additive: bool):
        if additive:
            value += struct.unpack("<H", self.uc.mem_read(address, 2))[0]
        self.uc.mem_write(address, struct.pack("<H", value & 0xFFFF))
