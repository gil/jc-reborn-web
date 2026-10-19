import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import load_resources  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_walk import CASES, WalkTracer, walk_data_bytes  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/walk"


def main() -> int:
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    resources = {resource.name: resource.payload for resource in load_resources(DATA)}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "walk-data.bin").write_bytes(walk_data_bytes(image))
    rows: list[list[object]] = []
    for k in range(CASES):
        started = time.monotonic()
        traced = WalkTracer(image, resources).trace_case(k)
        rows.extend(traced)
        print(f"case {k}: {len(traced)} rows, {time.monotonic() - started:.1f}s", file=sys.stderr)
    lines = ["case\tbeat\tevent\tvalues", *("\t".join(str(cell) for cell in row) for row in rows)]
    (OUT / "traces.tsv").write_text("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
