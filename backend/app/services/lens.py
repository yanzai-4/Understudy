"""Lens control: focus (rack-focus over the depth map) and zoom/focal-length
keyframes.

- Focus: per-frame focal plane d0 interpolated from keyframes; each pixel's
  blur = max_blur * clip(|depth - d0| / falloff, 0, 1). Rendered as a
  depth-of-field preview (dof/) plus a focus map (focus/, white = sharp) that
  downstream ControlNet-style workflows can consume.
- Zoom: keyframes carry focal-length choices (e.g. 35mm → 85mm); the crop
  scale at any frame is focal/min_focal, so the widest keyframe shows the full
  frame. Applied to every control channel at export time.

The phrase logic here is mirrored in frontend/src/lib/lensPhrase.ts — keep
them in sync (prompt parity).
"""

import json
import logging
import re
import traceback
from pathlib import Path

import cv2
import numpy as np

from app.services.video_io import imwrite_unicode

log = logging.getLogger(__name__)

BLUR_LEVELS = 5

DEFAULT_LENS: dict = {
    "focus": {
        "enabled": False,
        "max_blur": 12,
        "falloff": 0.35,
        "easing": "smooth",
        "follow_subject": False,  # focal plane auto-tracks the person matte
        "keyframes": [],
    },
    "zoom": {"enabled": False, "keyframes": []},
    "focal": None,
}


def normalize_lens(data: dict | None) -> dict:
    """Fill defaults so downstream code can rely on the full shape."""
    data = data or {}
    focus = {**DEFAULT_LENS["focus"], **(data.get("focus") or {})}
    zoom = {**DEFAULT_LENS["zoom"], **(data.get("zoom") or {})}
    focus["keyframes"] = sorted(focus.get("keyframes") or [], key=lambda k: k["frame"])
    zoom["keyframes"] = sorted(zoom.get("keyframes") or [], key=lambda k: k["frame"])
    return {"focus": focus, "zoom": zoom, "focal": data.get("focal")}


def focus_is_active(focus: dict) -> bool:
    """Focus produces output if it has keyframes or is set to follow the subject."""
    return bool(focus["enabled"] and (focus["keyframes"] or focus.get("follow_subject")))


def lens_is_active(data: dict) -> bool:
    lens = normalize_lens(data)
    zoom_on = lens["zoom"]["enabled"] and len(lens["zoom"]["keyframes"]) > 0
    return focus_is_active(lens["focus"]) or zoom_on or bool(lens["focal"])


# ---------- keyframe interpolation ----------


def _ease(t: float, easing: str) -> float:
    if easing == "smooth":
        return t * t * (3.0 - 2.0 * t)  # smoothstep
    return t


def interp_keyframes(keyframes: list[dict], frame: int, field: str, easing: str = "linear") -> float:
    """Value of `field` at `frame`: flat extrapolation outside, eased between."""
    if not keyframes:
        raise ValueError("no keyframes")
    if frame <= keyframes[0]["frame"]:
        return float(keyframes[0][field])
    if frame >= keyframes[-1]["frame"]:
        return float(keyframes[-1][field])
    for a, b in zip(keyframes, keyframes[1:]):
        if a["frame"] <= frame <= b["frame"]:
            span = b["frame"] - a["frame"]
            t = 0.0 if span == 0 else (frame - a["frame"]) / span
            t = _ease(t, easing)
            return float(a[field]) + (float(b[field]) - float(a[field])) * t
    return float(keyframes[-1][field])


# ---------- focus (depth of field) ----------


def focal_plane_at(lens: dict, frame: int) -> float | None:
    focus = lens["focus"]
    if not focus["enabled"] or not focus["keyframes"]:
        return None
    return interp_keyframes(focus["keyframes"], frame, "depth", focus.get("easing", "smooth"))


def subject_focal_plane(shot_dir: Path, frame_index: int, thresh: float = 0.5) -> float | None:
    """Median depth (0..1) inside the subject matte at this frame — the person's
    distance, so focus can auto-track them. None if the matte/depth is missing
    or the person is absent from the frame."""
    subj = shot_dir / "subject" / f"frame_{frame_index:06d}.png"
    depth_path = shot_dir / "depth" / f"frame_{frame_index:06d}.png"
    if not subj.exists() or not depth_path.exists():
        return None
    mask = cv2.imdecode(np.fromfile(subj, np.uint8), cv2.IMREAD_GRAYSCALE)
    depth = cv2.imdecode(np.fromfile(depth_path, np.uint8), cv2.IMREAD_GRAYSCALE)
    if mask.shape[:2] != depth.shape[:2]:
        mask = cv2.resize(mask, (depth.shape[1], depth.shape[0]), interpolation=cv2.INTER_LINEAR)
    sel = mask > int(thresh * 255)
    if int(sel.sum()) < 20:  # no meaningful subject in this frame
        return None
    return float(np.median(depth[sel])) / 255.0


def resolve_focal_plane(lens: dict, shot_dir: Path, frame_index: int) -> float | None:
    """Focal plane for a frame: the subject's depth when following the subject
    (falling back to keyframes if the person is absent), else keyframe-based."""
    focus = lens["focus"]
    if focus.get("enabled") and focus.get("follow_subject"):
        d = subject_focal_plane(shot_dir, frame_index)
        if d is not None:
            return d
    return focal_plane_at(lens, frame_index)


def render_dof(
    frame_bgr: np.ndarray, depth_gray: np.ndarray, d0: float, max_blur: float, falloff: float
) -> tuple[np.ndarray, np.ndarray]:
    """Returns (dof_preview_bgr, focus_map_gray). d0 in 0..1 (1 = near/white)."""
    h, w = frame_bgr.shape[:2]
    if depth_gray.shape[:2] != (h, w):
        depth_gray = cv2.resize(depth_gray, (w, h), interpolation=cv2.INTER_LINEAR)

    depth = depth_gray.astype(np.float32) / 255.0
    blur_frac = np.clip(np.abs(depth - d0) / max(falloff, 1e-3), 0.0, 1.0)

    # focus map: white = sharp
    focus_map = ((1.0 - blur_frac) * 255.0).astype(np.uint8)

    # quantize blur into levels and blend pre-blurred copies
    levels = [frame_bgr]
    for i in range(1, BLUR_LEVELS):
        sigma = max_blur * i / (BLUR_LEVELS - 1)
        levels.append(cv2.GaussianBlur(frame_bgr, (0, 0), sigmaX=max(sigma, 0.1)))

    idx = np.clip((blur_frac * (BLUR_LEVELS - 1)).round().astype(np.int32), 0, BLUR_LEVELS - 1)
    out = np.empty_like(frame_bgr)
    for i in range(BLUR_LEVELS):
        mask = idx == i
        out[mask] = levels[i][mask]
    return out, focus_map


# ---------- zoom / focal length ----------


def focal_mm(key: str | None) -> int | None:
    if not key:
        return None
    m = re.match(r"(\d+)", str(key))
    return int(m.group(1)) if m else None


def zoom_params_at(lens: dict, frame: int) -> tuple[float, float, float] | None:
    """(scale, cx, cy) at `frame`, or None when zoom is inactive.
    scale = focal/min_focal so the widest keyframe shows the full frame."""
    zoom = lens["zoom"]
    kfs = zoom["keyframes"]
    if not zoom["enabled"] or not kfs:
        return None
    mms = [focal_mm(k.get("focal")) or 35 for k in kfs]
    base = min(mms)
    enriched = [
        {"frame": k["frame"], "scale": mm / base, "cx": k.get("cx", 0.5), "cy": k.get("cy", 0.5)}
        for k, mm in zip(kfs, mms)
    ]
    scale = interp_keyframes(enriched, frame, "scale", "smooth")
    cx = interp_keyframes(enriched, frame, "cx", "smooth")
    cy = interp_keyframes(enriched, frame, "cy", "smooth")
    return max(1.0, scale), cx, cy


def crop_window(w: int, h: int, scale: float, cx: float, cy: float) -> tuple[int, int, int, int]:
    """Integer crop rect (x, y, cw, ch) for a zoom factor, clamped to bounds."""
    cw = max(2, int(round(w / scale)))
    ch = max(2, int(round(h / scale)))
    x = int(round(cx * w - cw / 2))
    y = int(round(cy * h - ch / 2))
    x = max(0, min(w - cw, x))
    y = max(0, min(h - ch, y))
    return x, y, cw, ch


def apply_zoom(img: np.ndarray, scale: float, cx: float, cy: float) -> np.ndarray:
    if scale <= 1.001:
        return img
    h, w = img.shape[:2]
    x, y, cw, ch = crop_window(w, h, scale, cx, cy)
    return cv2.resize(img[y : y + ch, x : x + cw], (w, h), interpolation=cv2.INTER_CUBIC)


def transform_points(points: np.ndarray, w: int, h: int, scale: float, cx: float, cy: float) -> np.ndarray:
    """Map original-frame xy coords into the zoomed frame's coords."""
    if scale <= 1.001:
        return points
    x, y, cw, ch = crop_window(w, h, scale, cx, cy)
    out = points.astype(np.float32).copy()
    out[..., 0] = (out[..., 0] - x) * (w / cw)
    out[..., 1] = (out[..., 1] - y) * (h / ch)
    return out


# ---------- prompt phrases (mirror: frontend/src/lib/lensPhrase.ts) ----------


def _depth_label(kf: dict) -> str:
    label = (kf.get("label") or "").strip()
    if label:
        return label
    d = float(kf.get("depth", 0.5))
    if d >= 0.66:
        return "the foreground subject"
    if d <= 0.33:
        return "the distant background"
    return "the mid-ground"


def lens_phrases(data: dict, mappings: dict, camera_move_set: bool) -> list[str]:
    """English prompt fragments describing focus/zoom intent."""
    lens = normalize_lens(data)
    phrases: list[str] = []

    focus = lens["focus"]
    if focus["enabled"] and focus.get("follow_subject"):
        phrases.append("focus following the subject, shallow depth of field")
    elif focus["enabled"] and focus["keyframes"]:
        kfs = focus["keyframes"]
        if len(kfs) == 1:
            phrases.append(f"sharp focus on {_depth_label(kfs[0])}")
        else:
            phrases.append(f"rack focus from {_depth_label(kfs[0])} to {_depth_label(kfs[-1])}")

    zoom = lens["zoom"]
    focal_options = {o["key"]: o["fragment"] for o in mappings.get("focal_lengths", [])}
    zoom_kfs = zoom["keyframes"] if zoom["enabled"] else []
    focals = [k.get("focal") for k in zoom_kfs if k.get("focal")]
    zoom_changes = len(zoom_kfs) >= 2 and len(set(focals)) >= 2

    if zoom_changes:
        # explicit camera_move selection wins over the auto zoom phrase
        if not camera_move_set:
            phrases.append(f"smooth zoom from {focals[0]} to {focals[-1]}")
    else:
        static_focal = (focals[0] if focals else None) or lens["focal"]
        if static_focal and static_focal in focal_options:
            phrases.append(focal_options[static_focal])

    return phrases


# ---------- full-sequence render task ----------


def run_lens_render(task_id: str, shot_id: str) -> None:
    """Render dof/ (preview jpegs) + focus/ (focus maps) for a shot."""
    from app.db import SessionLocal
    from app.models import LensState, Shot
    from app.services import paths
    from app.services.task_registry import TaskCancelled, registry

    db = SessionLocal()
    try:
        registry.start(task_id)
        shot = db.get(Shot, shot_id)
        if shot is None:
            raise RuntimeError("Shot no longer exists")
        state = db.get(LensState, shot_id)
        lens = normalize_lens(state.data if state else None)
        if not focus_is_active(lens["focus"]):
            raise RuntimeError("Focus is off — add keyframes or enable follow-subject")

        shot_dir = paths.shot_dir(shot.film_id, shot.id)
        frames = sorted((shot_dir / "frames").glob("frame_*.jpg"))
        if not frames:
            raise RuntimeError("No extracted frames")

        import shutil

        dof_dir = shot_dir / "dof"
        focus_dir = shot_dir / "focus"
        shutil.rmtree(dof_dir, ignore_errors=True)
        shutil.rmtree(focus_dir, ignore_errors=True)
        dof_dir.mkdir(parents=True)
        focus_dir.mkdir(parents=True)

        max_blur = float(lens["focus"]["max_blur"])
        falloff = float(lens["focus"]["falloff"])
        for i, frame_path in enumerate(frames):
            if registry.is_cancel_requested(task_id):
                raise TaskCancelled()
            frame = cv2.imdecode(np.fromfile(frame_path, np.uint8), cv2.IMREAD_COLOR)
            depth_path = shot_dir / "depth" / f"frame_{i:06d}.png"
            if not depth_path.exists():
                raise RuntimeError("Depth channel missing — extract depth first")
            depth = cv2.imdecode(np.fromfile(depth_path, np.uint8), cv2.IMREAD_GRAYSCALE)

            d0 = resolve_focal_plane(lens, shot_dir, i)
            zoom = zoom_params_at(lens, i)
            dof, fmap = render_dof(frame, depth, d0 if d0 is not None else 0.5, max_blur, falloff)
            if zoom:
                dof = apply_zoom(dof, *zoom)
                fmap = apply_zoom(fmap, *zoom)
            imwrite_unicode(dof_dir / f"frame_{i:06d}.jpg", dof, quality=88)
            imwrite_unicode(focus_dir / f"frame_{i:06d}.png", fmap)

            if i % 10 == 0:
                registry.set_progress(task_id, i / len(frames), f"rendering {i}/{len(frames)}")

        (shot_dir / "lens_render.json").write_text(
            json.dumps({"rendered_with": lens}, ensure_ascii=False), encoding="utf-8"
        )
        registry.finish(task_id, {"frame_count": len(frames)})
    except TaskCancelled:
        registry.mark_cancelled(task_id)
    except Exception as exc:
        log.error("Lens render %s failed:\n%s", task_id, traceback.format_exc())
        registry.fail(task_id, str(exc))
    finally:
        db.close()


def render_single_frame(shot_dir: Path, lens: dict, frame_index: int) -> np.ndarray | None:
    """On-demand preview of one frame with focus + zoom applied."""
    frame_path = shot_dir / "frames" / f"frame_{frame_index:06d}.jpg"
    if not frame_path.exists():
        return None
    frame = cv2.imdecode(np.fromfile(frame_path, np.uint8), cv2.IMREAD_COLOR)

    lens = normalize_lens(lens)
    d0 = resolve_focal_plane(lens, shot_dir, frame_index)
    if d0 is not None:
        depth_path = shot_dir / "depth" / f"frame_{frame_index:06d}.png"
        if depth_path.exists():
            depth = cv2.imdecode(np.fromfile(depth_path, np.uint8), cv2.IMREAD_GRAYSCALE)
            frame, _ = render_dof(
                frame, depth, d0, float(lens["focus"]["max_blur"]), float(lens["focus"]["falloff"])
            )
    zoom = zoom_params_at(lens, frame_index)
    if zoom:
        frame = apply_zoom(frame, *zoom)
    return frame
