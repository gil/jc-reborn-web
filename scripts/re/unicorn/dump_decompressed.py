import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import compressed_chunks, load_resources  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_decompress import decompress_original  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/decompressed"
HEADER = ["resource", "chunk", "bodyOffset", "method", "size", "produced", "file"]


def describe(data: bytes) -> str:
    if len(data) > 8 and len(set(data)) == 1:
        return f"`{data[0]:02x}` × {len(data)}"
    return f"`{data.hex(' ')}`"


def print_edge_cases(image: NeImage):
    from test_original_decompress import EDGE_CASES

    print("| Case | Body | Original output |")
    print("| --- | --- | --- |")
    for name, (body, _) in EDGE_CASES.items():
        shown = describe(body) if len(body) <= 40 else f"{len(body)} bytes, see `scripts/re/unicorn/test_original_decompress.py`"
        print(f"| {name} | {shown} | {describe(decompress_original(image, body, 0, len(body)))} |")


def dump_corpus(image: NeImage) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    short = 0
    for resource, chunk in compressed_chunks(load_resources(DATA)):
        (size,) = struct.unpack_from("<I", resource.payload, chunk.body_offset + 1)
        output = decompress_original(image, resource.payload, chunk.body_offset, chunk.size)
        file = f"{resource.name}.{chunk.path.replace(':', '')}.bin"
        (OUT / file).write_bytes(output)
        rows.append([resource.name, chunk.path, chunk.body_offset, resource.payload[chunk.body_offset], size, len(output), file])
        short += len(output) != size
        print(f"{resource.name} {chunk.path}: {len(output)}/{size}", file=sys.stderr)
    lines = ["\t".join(HEADER), *("\t".join(str(value) for value in row) for row in rows)]
    (OUT / "index.tsv").write_text("\n".join(lines) + "\n")
    print(f"{len(rows)} chunks, {short} short", file=sys.stderr)
    return 1 if short else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the original SCRANTIC.SCR decompressor on test inputs or the whole corpus")
    parser.add_argument("--edge-cases", action="store_true", help="print the edge-case table for docs/re/resources.md")
    args = parser.parse_args()
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    if args.edge_cases:
        print_edge_cases(image)
        return 0
    return dump_corpus(image)


if __name__ == "__main__":
    sys.exit(main())
