import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import CHUNKED_TYPES, Resource, load_resources, walk_chunks  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_loaders import AdsFraming, find_chunks_original, load_bmp_original, load_palette_original, load_screen_original, load_ttm_original  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/loaders"
LOADER_PATHS = {
    ".BMP": ["BMP:INF:", "BMP:BIN:", "BMP:VGA:", "BMP:AMG:", "BMP:MTX:"],
    ".SCR": ["SCR:DIM:", "SCR:BIN:", "SCR:VGA:", "SCR:AMG:"],
    ".PAL": ["PAL:VGA:"],
    ".TTM": ["PAG:", "TT3:"],
    ".ADS": ["ADS:RES:", "ADS:SCR:"],
}


def write_tsv(name: str, header: list[str], rows: list[list[object]]):
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["\t".join(header), *("\t".join(str(value) for value in row) for row in rows)]
    (OUT / name).write_text("\n".join(lines) + "\n")
    print(f"{name}: {len(rows)} rows", file=sys.stderr)


def chunked(resources: list[Resource], kind: str | None = None) -> list[Resource]:
    return [r for r in resources if r.name[-4:] in CHUNKED_TYPES and (kind is None or r.name[-4:] == kind)]


def dump_chunks(image: NeImage, resources: list[Resource]):
    rows = []
    for resource in chunked(resources):
        walked = [chunk.path for chunk in walk_chunks(resource.payload)]
        for path in dict.fromkeys([*walked, *LOADER_PATHS[resource.name[-4:]]]):
            [found] = find_chunks_original(image, resource.name, resource.payload, [path])
            position, size = found or (-1, -1)
            rows.append([resource.name, path, position, size])
    write_tsv("chunks.tsv", ["resource", "path", "position", "size"], rows)


def dump_palette(image: NeImage, resources: list[Resource]):
    [palette] = chunked(resources, ".PAL")
    colors = load_palette_original(image, palette.name, palette.payload)
    write_tsv("palette.tsv", ["index", "red", "green", "blue"], [[i, *colors[i * 3:i * 3 + 3]] for i in range(16)])


def dump_screens(image: NeImage, resources: list[Resource]):
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for resource in chunked(resources, ".SCR"):
        result = load_screen_original(image, resource.name, resource.payload)
        file = f"{resource.name}.pixels.bin"
        (OUT / file).write_bytes(result.pixels)
        width = ",".join(str(w) for w in sorted(result.widths))
        rows.append([resource.name, result.status, width, sum(count for _, count in result.strips), file])
    write_tsv("screens.tsv", ["resource", "status", "width", "rows", "file"], rows)


def dump_bitmaps(image: NeImage, resources: list[Resource]):
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for resource in chunked(resources, ".BMP"):
        result = load_bmp_original(image, resource.name, resource.payload)
        file = f"{resource.name}.packed.bin"
        (OUT / file).write_bytes(result.packed)
        rows.append([resource.name, ",".join(map(str, result.widths)), ",".join(map(str, result.heights)), file])
    write_tsv("bitmaps.tsv", ["resource", "widths", "heights", "file"], rows)


def dump_ttm(image: NeImage, resources: list[Resource]):
    rows = []
    for resource in chunked(resources, ".TTM"):
        index = load_ttm_original(image, resource.name, resource.payload)
        offsets = ",".join(map(str, index.page_offsets))
        tags = ",".join(f"{tag}@{page}" for tag, page in index.tags)
        rows.append([resource.name, index.status, index.page_count, offsets, tags])
    write_tsv("ttm.tsv", ["resource", "status", "pageCount", "pageOffsets", "tags"], rows)


def dump_ads_arg_counts(image: NeImage, resources: list[Resource]):
    framing = AdsFraming(image)
    rows = [[f"{opcode:04x}", args] for opcode in range(0x10000) if (args := framing.arg_count(opcode))]
    write_tsv("ads-arg-counts.tsv", ["opcode", "args"], rows)


COMMANDS = {
    "ads-arg-counts": dump_ads_arg_counts,
    "bitmaps": dump_bitmaps,
    "chunks": dump_chunks,
    "palette": dump_palette,
    "screens": dump_screens,
    "ttm": dump_ttm,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the original SCRANTIC.SCR loaders on every resource; fixtures go to re/fixtures/loaders/")
    parser.add_argument("what", nargs="*", help=f"fixtures to write, any of {', '.join(sorted(COMMANDS))} (default: all)")
    args = parser.parse_args()
    unknown = sorted(set(args.what) - set(COMMANDS))
    if unknown:
        parser.error(f"unknown fixture {', '.join(unknown)}")
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    resources = load_resources(DATA)
    for name in args.what or sorted(COMMANDS):
        COMMANDS[name](image, resources)
    return 0


if __name__ == "__main__":
    sys.exit(main())
