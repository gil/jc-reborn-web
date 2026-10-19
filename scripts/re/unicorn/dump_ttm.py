import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import load_resources  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_ttm import TtmTracer  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/ttm"


def main() -> int:
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    resources = {resource.name: resource.payload for resource in load_resources(DATA)}
    rows: list[list[object]] = []
    for name in sorted(name for name in resources if name.upper().endswith(".TTM")):
        tracer = TtmTracer(image, resources, name)
        traced = tracer.trace()
        rows.extend(traced)
        print(f"{name}: {len(tracer.pages)} pages, {len(traced)} rows", file=sys.stderr)
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["ttm\tpage\tpass\tevent\tvalues", *("\t".join(str(cell) for cell in row) for row in rows)]
    (OUT / "traces.tsv").write_text("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
