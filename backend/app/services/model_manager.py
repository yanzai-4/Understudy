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
    # Scene layout segmentation (TopFormer ADE20K, Apache-2.0), for the optional
    # "layout" channel. Self-hosted as a GitHub release asset for a stable URL.
    "topformer_ade20k": {
        "name": "TopFormer scene layout (ADE20K)",
        "url": "https://github.com/yanzai-4/Understudy/releases/download/models-v1/topformer_ade20k_512.onnx",
        "relpath": "topformer_ade20k/topformer_ade20k_512.onnx",
        "size_mb": 12,
    },
    # Foreground object detector for the layout channel (YOLOX, Apache-2.0).
    # Two tiers: tiny (fast, any machine) and l (quality, strong GPU / Apple
    # Silicon). Same decode path — only the weights differ. These are the raw
    # (undecoded) ONNX exports from YOLOX's own ONNXRuntime demo release, which
    # object_detect.py decodes; linked directly from the upstream stable tag.
    "yolox_tiny": {
        "name": "YOLOX-tiny object detector (fast)",
        "url": "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx",
        "relpath": "yolox/yolox_tiny.onnx",
        "size_mb": 24,
    },
    "yolox_l": {
        "name": "YOLOX-l object detector (quality)",
        "url": "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_l.onnx",
        "relpath": "yolox/yolox_l.onnx",
        "size_mb": 210,
    },
}

RTMLIB_KEY = "pose_rtmlib"


def model_path(key: str) -> Path:
    return settings.models_dir / MANAGED_MODELS[key]["relpath"]


def depth_key_for(variant: str) -> str:
    return "depth_anything_v2_int8" if variant != "fp32" else "depth_anything_v2_fp32"


def depth_model_path(variant: str) -> Path:
    return model_path(depth_key_for(variant))


def detector_key_for(layout_model: str) -> str:
    return "yolox_l" if layout_model == "quality" else "yolox_tiny"


def detector_model_path(layout_model: str) -> Path:
    return model_path(detector_key_for(layout_model))


def _rtmlib_cache_dir() -> Path:
    return Path.home() / ".cache" / "rtmlib"


def rtmlib_ready() -> bool:
    cache = _rtmlib_cache_dir()
    return cache.exists() and any(cache.rglob("*.onnx"))


def is_ready(key: str) -> bool:
    if key == RTMLIB_KEY:
        return rtmlib_ready()
    return key in MANAGED_MODELS and model_path(key).exists()


def required_keys_for(
    channels: list[str], depth_variant: str, layout_model: str = "fast"
) -> list[str]:
    """Model keys needed to extract the given channels."""
    keys: list[str] = []
    if "pose" in channels:
        keys.append(RTMLIB_KEY)
    if "depth" in channels:
        keys.append(depth_key_for(depth_variant))
    if "layout" in channels:
        keys.append("topformer_ade20k")
        keys.append(detector_key_for(layout_model))
    return keys


def download_required_cli() -> None:
    """Pre-download the default required models during install (setup.ps1).

    Covers the default extraction channels (pose / depth / layout): pose +
    depth-int8 are core (a failure aborts install); the layout pair (TopFormer
    seg + YOLOX-tiny detector) is best-effort — if it can't be fetched now it
    lazy-downloads on the first layout extraction instead of bricking setup.
    The heavy quality detector (yolox_l) stays lazy — only fetched if a user
    with real GPU headroom opts into it.
    """
    core = (RTMLIB_KEY, "depth_anything_v2_int8")
    optional = ("topformer_ade20k", "yolox_tiny")  # layout pair
    for key in (*core, *optional):
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

        try:
            download_model(key, cb)
            print(f"  {key}: done")
        except Exception as exc:
            if key in optional:
                print(f"  {key}: skipped ({exc}); will download on first layout use")
            else:
                raise


def ensure_models(
    channels: list[str],
    depth_variant: str,
    layout_model: str,
    progress_cb: Callable[[float, str], None],
) -> None:
    """Fallback download of any required-but-missing models before extraction.

    Normally a no-op because setup.ps1 pre-downloads them; only the first
    extraction after switching depth precision / layout model (or a skipped
    install) hits this.
    """
    missing = [k for k in required_keys_for(channels, depth_variant, layout_model) if not is_ready(k)]
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
