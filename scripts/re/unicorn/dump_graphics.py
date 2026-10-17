import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import load_resources
from ne_image import NeImage
from original_graphics import create_brush_original, masks_and_mirrors_original
from original_loaders import load_bmp_original

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/graphics"
PALETTE = bytes(value for i in range(16) for value in (i, 0x10 + i, 0x20 + i))


def write_tsv(name: str, header: list[str], rows: list[list[object]]):
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["\t".join(header), *("\t".join(str(cell) for cell in row) for row in rows)]
    (OUT / name).write_text("\n".join(lines) + "\n")


def dump_brushes(image: NeImage, resources):
    rows = []
    for color in range(256):
        brush = create_brush_original(image, color, PALETTE)
        if brush.kind == "solid":
            rows.append([color, "solid", f"{brush.colorref[0]:04x}", f"{brush.colorref[1]:04x}", ""])
        else:
            rows.append([color, "pattern", "", "", brush.dib[0x68:].hex()])
    write_tsv("brushes.tsv", ["color", "kind", "colorrefLow", "colorrefHigh", "bits"], rows)


def dump_masks(image: NeImage, resources):
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for resource in resources:
        if not resource.name.endswith(".BMP"):
            continue
        bitmap = load_bmp_original(image, resource.name, resource.payload)
        masks, mirrored = masks_and_mirrors_original(image, bitmap.widths, bitmap.heights, bitmap.packed)
        (OUT / f"{resource.name}.masks.bin").write_bytes(masks)
        (OUT / f"{resource.name}.mirrored.bin").write_bytes(mirrored)
        rows.append([resource.name, ",".join(map(str, bitmap.widths)), ",".join(map(str, bitmap.heights)), f"{resource.name}.masks.bin", f"{resource.name}.mirrored.bin"])
    write_tsv("masks.tsv", ["resource", "widths", "heights", "masks", "mirrored"], rows)


COMMANDS = {
    "brushes": dump_brushes,
    "masks": dump_masks,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run original SCRANTIC.SCR graphics code; fixtures go to re/fixtures/graphics/")
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
