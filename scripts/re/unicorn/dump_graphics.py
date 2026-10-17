import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import load_resources
from ne_image import NeImage
from original_graphics import DC_A, DC_B, DC_C, WIPES, DirtyEmulator, create_brush_original, masks_and_mirrors_original, wipe_shapes_original
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


DIRTY_SEQUENCES = 300
DIRTY_STEPS = 40
DIRTY_PAIRS = [(DC_B, DC_A), (DC_C, DC_B), (DC_A, DC_C)]


def random_rect(rng: random.Random) -> list[int]:
    size = (lambda: rng.randint(0, 120)) if rng.random() < 0.85 else (lambda: rng.randint(200, 700))
    return [rng.randint(-60, 680), rng.randint(-60, 520), size(), size()]


def random_clip(rng: random.Random) -> list[int] | None:
    if rng.random() < 0.6:
        return None
    x1, y1 = rng.randint(-20, 500), rng.randint(-20, 400)
    return [x1, y1, x1 + rng.randint(0, 300), y1 + rng.randint(0, 200)]


def random_op(rng: random.Random) -> list:
    source, target = rng.choice(DIRTY_PAIRS)
    age = rng.choice([0, 0, 1])
    roll = rng.random()
    if roll < 0.68:
        kind = 1 if rng.random() < 0.85 else 4
        return ["add", *random_rect(rng), kind, source, target, age, random_clip(rng), rng.randint(1, 999)]
    if roll < 0.78:
        return ["overlaps", *random_rect(rng), target, age]
    if roll < 0.86:
        return ["replay", source, target, age]
    if roll < 0.95:
        return ["restore", rng.choice([0, 0, 1])]
    if roll < 0.98:
        return ["drop", source, target, age]
    return ["clear"]


def dump_dirty(image: NeImage, resources):
    rng = random.Random(4)
    rows = []
    for sequence in range(DIRTY_SEQUENCES):
        dirty = DirtyEmulator(image)
        for step in range(DIRTY_STEPS):
            op = random_op(rng)
            result = dirty.run(op)
            rows.append([sequence, step, json.dumps(op, separators=(",", ":")), json.dumps(result, separators=(",", ":")), json.dumps(dirty.lists(), separators=(",", ":"))])
    write_tsv("dirty.tsv", ["sequence", "step", "op", "result", "lists"], rows)
    table = DirtyEmulator(image)
    write_tsv("restore-table.tsv", ["which", "source", "target"], [[which, *pair] for which in (0, 1) for pair in table.restore_table(which)])


WIPE_AREAS = [(0, 0, 640, 480), (80, 60, 640, 480)]


def dump_wipes(image: NeImage, resources):
    rows = []
    for name in WIPES:
        for x, y, w, h in WIPE_AREAS:
            shapes = wipe_shapes_original(image, name, x, y, w, h)
            rows.append([name, x, y, w, h, json.dumps(shapes, separators=(",", ":"))])
    write_tsv("wipes.tsv", ["wipe", "x", "y", "w", "h", "shapes"], rows)


COMMANDS = {
    "brushes": dump_brushes,
    "masks": dump_masks,
    "dirty": dump_dirty,
    "wipes": dump_wipes,
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
