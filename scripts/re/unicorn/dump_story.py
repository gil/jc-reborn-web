import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ne_image import NeImage  # noqa: E402
from original_story import CASES, StoryTracer, random_rows, table_bytes  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/story"


def write_tsv(path: Path, header: str, rows: list[list[object]]):
    path.write_text("\n".join([header, *("\t".join(str(cell) for cell in row) for row in rows)]) + "\n")


def main() -> int:
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    OUT.mkdir(parents=True, exist_ok=True)
    scenes, random_table = table_bytes(image)
    (OUT / "scene-table.bin").write_bytes(scenes)
    (OUT / "random-table.bin").write_bytes(random_table)
    write_tsv(OUT / "random.tsv", "kind\tseed\tcall\tvalue", random_rows(image))
    rows: list[list[object]] = []
    for k in range(CASES):
        started = time.monotonic()
        rows.extend(StoryTracer(image).trace_case(k))
        print(f"case {k}: {time.monotonic() - started:.1f}s", file=sys.stderr)
    write_tsv(OUT / "sequences.tsv", "case\tbuild\tevent\tvalues", rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
