"""Render normalized background-edit boxes into black/white PNG masks.

Two variants per edit: one matched to the extraction output size (aligned with
the control-signal frames) and one at the original video resolution, for tools
that inpaint on the source footage.
"""

from pathlib import Path

import numpy as np

from app.models import BackgroundEdit, Shot
from app.services import paths
from app.services.pipeline import load_extraction_meta
from app.services.video_io import imwrite_unicode


def _render(width: int, height: int, x: float, y: float, w: float, h: float) -> np.ndarray:
    mask = np.zeros((height, width), dtype=np.uint8)
    x0 = max(0, min(width, round(x * width)))
    y0 = max(0, min(height, round(y * height)))
    x1 = max(0, min(width, round((x + w) * width)))
    y1 = max(0, min(height, round((y + h) * height)))
    mask[y0:y1, x0:x1] = 255
    return mask


def render_masks(shot: Shot, edit: BackgroundEdit) -> str | None:
    """Write mask PNGs for one edit; returns the relative mask path (out_size version)."""
    masks_dir = paths.shot_dir(shot.film_id, shot.id) / "masks"
    masks_dir.mkdir(parents=True, exist_ok=True)

    rel_path: str | None = None

    meta = load_extraction_meta(shot.film_id, shot.id)
    if meta:
        out_w, out_h = meta["output_size"]
        out_file = masks_dir / f"edit_{edit.id}.png"
        imwrite_unicode(out_file, _render(out_w, out_h, edit.x, edit.y, edit.w, edit.h))
        rel_path = f"masks/edit_{edit.id}.png"

    if shot.video_width and shot.video_height:
        full_file = masks_dir / f"edit_{edit.id}_full.png"
        imwrite_unicode(
            full_file,
            _render(shot.video_width, shot.video_height, edit.x, edit.y, edit.w, edit.h),
        )
        rel_path = rel_path or f"masks/edit_{edit.id}_full.png"

    return rel_path


def delete_masks(shot: Shot, edit_id: int) -> None:
    masks_dir = paths.shot_dir(shot.film_id, shot.id) / "masks"
    for name in (f"edit_{edit_id}.png", f"edit_{edit_id}_full.png"):
        Path(masks_dir / name).unlink(missing_ok=True)
