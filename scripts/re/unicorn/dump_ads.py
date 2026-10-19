import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import load_resources  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_ads import TICK_LIMIT, AdsTracer  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/ads"


def main() -> int:
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    resources = {resource.name: resource.payload for resource in load_resources(DATA)}
    rows: list[list[object]] = []
    for name in sorted(name for name in resources if name.upper().endswith(".ADS")):
        for tag in AdsTracer(image, resources, name).section_tags():
            started = time.monotonic()
            traced = AdsTracer(image, resources, name).trace_section(tag)
            rows.extend(traced)
            ticks = int(traced[-1][2]) + 1
            limit = " (tick limit)" if ticks == TICK_LIMIT else ""
            print(f"{name} {tag}: {ticks} ticks{limit}, {len(traced)} rows, {time.monotonic() - started:.1f}s", file=sys.stderr)
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["ads\ttag\ttick\tevent\tvalues", *("\t".join(str(cell) for cell in row) for row in rows)]
    (OUT / "traces.tsv").write_text("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
