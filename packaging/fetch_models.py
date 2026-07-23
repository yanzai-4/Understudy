"""Fetch the default models to bundle into the frozen app.

Downloads into packaging/models/<relpath> so understudy.spec can bundle them,
giving the packaged app a zero-download first run for depth + layout. (Pose
weights come from rtmlib's own cache and still fetch on first pose extraction.)
"""
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.services.model_manager import MANAGED_MODELS  # noqa: E402

BUNDLE = {"depth_anything_v2_int8", "topformer_ade20k", "yolox_tiny"}
OUT = Path(__file__).resolve().parent / "models"


def main() -> None:
    for key in sorted(BUNDLE):
        spec = MANAGED_MODELS[key]
        dst = OUT / spec["relpath"]
        if dst.exists():
            print(f"have {key} ({dst.stat().st_size // 1024} KB)")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {key} <- {spec['url']}")
        urllib.request.urlretrieve(spec["url"], dst)
        print(f"  -> {dst} ({dst.stat().st_size // 1024} KB)")
    print("done")


if __name__ == "__main__":
    main()
