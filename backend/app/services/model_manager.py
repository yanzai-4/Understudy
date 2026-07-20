"""Model inventory and downloads.

Two kinds of models:
- Directly managed ONNX files (Depth Anything V2) downloaded from HuggingFace
  into models/ with streamed progress.
- rtmlib pose models, which rtmlib downloads into its own cache on first use;
  we expose a pseudo-model entry that pre-warms that cache.
"""

import logging
from pathlib import Path
from typing import Callable

import requests

from app.config import settings

log = logging.getLogger(__name__)

DEPTH_DIR = "depth_anything_v2"

MANAGED_MODELS: dict[str, dict] = {
    "depth_anything_v2_int8": {
        "name": "Depth Anything V2 Small (int8)",
        "url": "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_int8.onnx",
        "relpath": f"{DEPTH_DIR}/model_int8.onnx",
        "size_mb": 28,
    },
    "depth_anything_v2_fp32": {
        "name": "Depth Anything V2 Small (fp32)",
        "url": "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx",
        "relpath": f"{DEPTH_DIR}/model.onnx",
        "size_mb": 100,
    },
}

RTMLIB_KEY = "pose_rtmlib"


def model_path(key: str) -> Path:
    return settings.models_dir / MANAGED_MODELS[key]["relpath"]


def depth_key_for(variant: str) -> str:
    return "depth_anything_v2_int8" if variant != "fp32" else "depth_anything_v2_fp32"


def depth_model_path(variant: str) -> Path:
    return model_path(depth_key_for(variant))


def _rtmlib_cache_dir() -> Path:
    return Path.home() / ".cache" / "rtmlib"


def rtmlib_ready() -> bool:
    cache = _rtmlib_cache_dir()
    return cache.exists() and any(cache.rglob("*.onnx"))


def is_ready(key: str) -> bool:
    if key == RTMLIB_KEY:
        return rtmlib_ready()
    return key in MANAGED_MODELS and model_path(key).exists()


def required_keys_for(channels: list[str], depth_variant: str) -> list[str]:
    """Model keys needed to extract the given channels (canny needs none)."""
    keys: list[str] = []
    if "pose" in channels:
        keys.append(RTMLIB_KEY)
    if "depth" in channels:
        keys.append(depth_key_for(depth_variant))
    return keys


def download_required_cli() -> None:
    """Pre-download the default required models during install (setup.ps1)."""
    for key in (RTMLIB_KEY, "depth_anything_v2_int8"):
        if is_ready(key):
            print(f"  {key}: already present")
            continue
        print(f"  downloading {key} ...")
        last = [-10]

        def cb(p: float, _stage: str, _last=last) -> None:
            pct = int(p * 100)
            if pct >= _last[0] + 10:
                _last[0] = pct
                print(f"    {pct}%")

        download_model(key, cb)
        print(f"  {key}: done")


def ensure_models(
    channels: list[str], depth_variant: str, progress_cb: Callable[[float, str], None]
) -> None:
    """Fallback download of any required-but-missing models before extraction.

    Normally a no-op because setup.ps1 pre-downloads them; only the first
    extraction after switching depth precision (or a skipped install) hits this.
    """
    missing = [k for k in required_keys_for(channels, depth_variant) if not is_ready(k)]
    for i, key in enumerate(missing):
        download_model(
            key,
            lambda p, stage, _i=i, _n=len(missing): progress_cb((_i + p) / _n, stage),
        )


def list_models() -> list[dict]:
    items = []
    for key, spec in MANAGED_MODELS.items():
        path = model_path(key)
        items.append(
            {
                "key": key,
                "name": spec["name"],
                "size_mb": spec["size_mb"],
                "status": "ready" if path.exists() else "missing",
                "required": key == "depth_anything_v2_int8",
            }
        )
    items.append(
        {
            "key": RTMLIB_KEY,
            "name": "RTMPose body detection + pose (rtmlib)",
            "size_mb": 60,
            "status": "ready" if rtmlib_ready() else "missing",
            "required": True,
        }
    )
    return items


def download_model(key: str, progress_cb: Callable[[float, str], None]) -> None:
    if key == RTMLIB_KEY:
        _warm_rtmlib(progress_cb)
        return
    spec = MANAGED_MODELS[key]
    dest = model_path(key)
    if dest.exists():
        progress_cb(1.0, "already_present")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")

    progress_cb(0.0, f"downloading {spec['name']}")
    with requests.get(spec["url"], stream=True, timeout=60, allow_redirects=True) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        written = 0
        with tmp.open("wb") as out:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                out.write(chunk)
                written += len(chunk)
                if total:
                    progress_cb(written / total, f"downloading {spec['name']}")
    if total and written != total:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Incomplete download for {key} ({written}/{total} bytes)")
    tmp.replace(dest)
    progress_cb(1.0, "done")
    log.info("Downloaded model %s -> %s", key, dest)


def _warm_rtmlib(progress_cb: Callable[[float, str], None]) -> None:
    """Instantiating rtmlib Body triggers its own model download into ~/.cache."""
    progress_cb(0.05, "downloading rtmlib pose models")
    from rtmlib import Body

    Body(mode="balanced", backend="onnxruntime", device="cpu", to_openpose=True)
    progress_cb(1.0, "done")
