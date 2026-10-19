import struct
from dataclasses import dataclass

from emulator import Emulator
from ne_image import NeImage

OPEN_STREAM = "1028:0615"
READ_STREAM = "1028:0a0d"
CLOSE_STREAM = "1028:0875"
FILE_READ = "1018:1287"
FILE_GETC = "1018:14e9"
FILE_SEEK = "1018:1398"
FILE_TELL = "1018:1475"
NEAR_CALLOC = "1038:06a8"
NEAR_FREE = "1038:063b"
FAR_ALLOC = "1030:199a"
FAR_FREE = "1030:1b63"
READ_MODE = 0x2620
FILE_HANDLE = 7
READ_STEP = 0x8000
FAILED = 0xFFFF


class OpenFailed(Exception):
    pass


@dataclass
class VirtualFile:
    data: bytes
    pos: int


def chunk_body(method: int, size: int, data: bytes) -> bytes:
    return bytes([method]) + struct.pack("<I", size) + data


def pack_codes(codes: list[tuple[int, int]]) -> bytes:
    out = bytearray()
    acc = held = 0
    for code, bits in codes:
        acc |= code << held
        held += bits
        while held >= 8:
            out.append(acc & 0xFF)
            acc >>= 8
            held -= 8
    if held:
        out.append(acc & 0xFF)
    return bytes(out)


def decompress_original(image: NeImage, data: bytes, body_offset: int, body_size: int) -> bytes:
    emu = Emulator(image)
    install_heap(emu)
    _install_file(emu, VirtualFile(data, body_offset))
    (size,) = struct.unpack_from("<I", data, body_offset + 1)
    stream = emu.call_far(OPEN_STREAM, stack_words=[body_size >> 16, body_size & 0xFFFF, READ_MODE, FILE_HANDLE, 0])["ax"]
    if stream == FAILED:
        raise OpenFailed(f"method {data[body_offset]} did not open")
    out_segment, _ = emu.alloc(size)
    produced = 0
    while produced < size:
        step = min(READ_STEP, size - produced)
        got = emu.call_far(READ_STREAM, stack_words=[step, out_segment + produced // 16, 0, stream])["ax"]
        if got == FAILED:
            raise RuntimeError(f"stream {stream} read failed after {produced} bytes")
        produced += got
        if got < step:
            break
    emu.call_far(CLOSE_STREAM, stack_words=[stream])
    return emu.read(out_segment, 0, produced)


def install_heap(emu: Emulator):
    def near_calloc(emu: Emulator):
        size = emu.arg(0) * emu.arg(1)
        offset = emu.near_alloc(size)
        emu.write(emu.data_segment, offset, bytes(size))
        return {"ax": offset}

    def far_alloc(emu: Emulator):
        segment, offset = emu.alloc(emu.arg(0) | emu.arg(1) << 16)
        return {"ax": offset, "dx": segment}

    emu.replace_function(NEAR_CALLOC, near_calloc)
    emu.replace_function(NEAR_FREE, lambda emu: {"ax": 0})
    emu.replace_function(FAR_ALLOC, far_alloc)
    emu.replace_function(FAR_FREE, lambda emu: {"ax": 1})


def _install_file(emu: Emulator, file: VirtualFile):
    def expect_handle(handle: int):
        if handle != FILE_HANDLE:
            raise RuntimeError(f"file call with handle {handle:#x}, argument layout is wrong")

    def read(emu: Emulator):
        expect_handle(emu.arg(3))
        buf, size, count = emu.arg(0), emu.arg(1), emu.arg(2)
        data = file.data[file.pos:file.pos + size * count]
        file.pos += len(data)
        emu.write(emu.data_segment, buf, data)
        return {"ax": len(data) // size if size else 0}

    def getc(emu: Emulator):
        expect_handle(emu.arg(0))
        if file.pos >= len(file.data):
            return {"ax": FAILED}
        file.pos += 1
        return {"ax": file.data[file.pos - 1]}

    def seek(emu: Emulator):
        expect_handle(emu.arg(0))
        (offset,) = struct.unpack("<i", struct.pack("<HH", emu.arg(1), emu.arg(2)))
        file.pos = {0: 0, 1: file.pos, 2: len(file.data)}[emu.arg(3)] + offset
        return {"ax": 0, "dx": 0}

    def tell(emu: Emulator):
        expect_handle(emu.arg(0))
        return {"ax": file.pos & 0xFFFF, "dx": file.pos >> 16}

    for address, handler in ((FILE_READ, read), (FILE_GETC, getc), (FILE_SEEK, seek), (FILE_TELL, tell)):
        emu.replace_function(address, handler)
