"""Lens control: focus (rack-focus over the depth map) and zoom/focal-length,
both expressed as timeline *segments*.

A segment is a frame range [start, end] holding one steady value. Inside a
segment the value is held; in a gap between two segments it eases from one to
the next (the gap length = how slow the rack is); two touching segments
(a.end == b.start) share a single switch frame ("交汇点"). Before the first /
after the last segment the value is held flat. Each lane allows up to 3
segments (SEGMENT_CAP).

- Focus: per-frame focal plane d0 from the focus segments; each pixel's
  blur = max_blur * clip(|depth - d0| / falloff, 0, 1). Rendered as a
  depth-of-field preview (dof/) plus a focus map (focus/, white = sharp) that
  downstream ControlNet-style workflows can consume. `follow_subject` is an
  exclusive mode: when on, segments are ignored and focus auto-tracks the
  performer (from pose) for the whole shot.
- Zoom: segments carry focal-length choices (e.g. 35mm → 85mm); the crop
  scale at any frame is focal/min_focal, so the widest value shows the full
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
SEGMENT_CAP = 3  # max segments per lane (focus, zoom)

FOCUS_SEG_DEFAULT: dict = {"start": 0, "end": 0, "depth": 0.5, "label": ""}
ZOOM_SEG_DEFAULT: dict = {"start": 0, "end": 0, "focal": "50mm", "cx": 0.5, "cy": 0.5}

DEFAULT_LENS: dict = {
    "focus": {
        "enabled": False,
        "max_blur": 12,
        "falloff": 0.35,
        "easing": "smooth",
        "follow_subject": False,  # exclusive: auto-track the person (from pose)
        "segments": [],
    },
    "zoom": {"enabled": False, "segments": []},
    "focal": None,
}


def _clean_segments(raw: list | None, defaults: dict) -> list[dict]:
    """Coerce, sort and de-overlap segments; cap at SEGMENT_CAP.

    Each segment keeps only the known keys; start/end are ints with start<=end,
    and every start is clipped up to the previous segment's end so segments
    never overlap (equal edges = a 交汇点)."""
    segs: list[dict] = []
    for s in raw or []:
        if not isinstance(s, dict):
            continue
        seg = {k: (s[k] if k in s else defaults[k]) for k in defaults}
        seg["start"] = int(seg["start"])
        seg["end"] = int(seg["end"])
        if seg["end"] < seg["start"]:
            seg["start"], seg["end"] = seg["end"], seg["start"]
        segs.append(seg)
    segs.sort(key=lambda s: (s["start"], s["end"]))
    prev_end: int | None = None
    for seg in segs:
        if prev_end is not None and seg["start"] < prev_end:
            seg["start"] = prev_end
            if seg["end"] < seg["start"]:
                seg["end"] = seg["start"]
        prev_end = seg["end"]
    return segs[:SEGMENT_CAP]


def _segments_from(lane: dict, defaults: dict) -> list[dict]:
    """Read a lane's segments, migrating legacy `keyframes` if needed."""
    if lane.get("segments") is not None:
        return _clean_segments(lane["segments"], defaults)
    legacy = lane.get("keyframes")
    if legacy:  # each old keyframe → a zero-width segment at its frame
        migrated = [{**k, "start": k.get("frame", 0), "end": k.get("frame", 0)} for k in legacy]
        return _clean_segments(migrated, defaults)
    return []


def normalize_lens(data: dict | None) -> dict:
    """Fill defaults so downstream code can rely on the full shape."""
    data = data or {}
    focus = {**DEFAULT_LENS["focus"], **(data.get("focus") or {})}
    zoom = {**DEFAULT_LENS["zoom"], **(data.get("zoom") or {})}
    focus["segments"] = _segments_from(data.get("focus") or {}, FOCUS_SEG_DEFAULT)
    zoom["segments"] = _segments_from(data.get("zoom") or {}, ZOOM_SEG_DEFAULT)
    focus.pop("keyframes", None)
    zoom.pop("keyframes", None)
    return {"focus": focus, "zoom": zoom, "focal": data.get("focal")}


def focus_is_active(focus: dict) -> bool:
    """Focus produces output if it has segments or is set to follow the subject."""
    return bool(focus["enabled"] and (focus["segments"] or focus.get("follow_subject")))


def lens_is_active(data: dict) -> bool:
    lens = normalize_lens(data)
    zoom_on = lens["zoom"]["enabled"] and len(lens["zoom"]["segments"]) > 0
    return focus_is_active(lens["focus"]) or zoom_on or bool(lens["focal"])


# ---------- segment interpolation ----------


def _ease(t: float, easing: str) -> float:
    if easing == "smooth":
        return t * t * (3.0 - 2.0 * t)  # smoothstep
    return t


def segment_value_at(segments: list[dict], frame: int, field: str, easing: str = "smooth") -> float:
    """Value of `field` at `frame` for a sorted, non-overlapping segment list:
    held steady inside a segment, eased across a gap between segments, flat
    outside the first/last. Touching segments switch at their shared frame."""
    if not segments:
        raise ValueError("no segments")
    if frame <= segments[0]["start"]:
        return float(segments[0][field])
    if frame >= segments[-1]["end"]:
        return float(segments[-1][field])
    for seg in segments:  # inside a segment → steady hold
        if seg["start"] <= frame <= seg["end"]:
            return float(seg[field])
    for a, b in zip(segments, segments[1:]):  # in a gap → ease a→b
        if a["end"] < frame < b["start"]:
            span = b["start"] - a["end"]
            t = 0.0 if span == 0 else (frame - a["end"]) / span
            t = _ease(t, easing)
            return float(a[field]) + (float(b[field]) - float(a[field])) * t
    return float(segments[-1][field])


# ---------- focus (depth of field) ----------


def _within_span(segs: list[dict], frame: int) -> bool:
    """The effect is confined to the segments' outer span — before the first
    start / after the last end there is no focus/zoom (sharp, full frame)."""
    return bool(segs) and segs[0]["start"] <= frame <= segs[-1]["end"]


def focal_plane_at(lens: dict, frame: int) -> float | None:
    focus = lens["focus"]
    if not focus["enabled"] or not _within_span(focus["segments"], frame):
        return None
    return segment_value_at(focus["segments"], frame, "depth", focus.get("easing", "smooth"))


def subject_focal_plane(shot_dir: Path, frame_index: int, score_thr: float = 0.3) -> float | None:
    """Median depth (0..1) at the person's pose keypoints this frame — their
    distance, so focus can auto-track them. Sourced from the pose channel
    (stabler than a matte). None if pose/depth is missing or nobody is present."""
    import json

    kp_path = shot_dir / "pose" / "keypoints.json"
    depth_path = shot_dir / "depth" / f"frame_{frame_index:06d}.png"
    if not kp_path.exists() or not depth_path.exists():
        return None
    try:
        frames = json.loads(kp_path.read_text(encoding="utf-8")).get("frames", [])
    except (OSError, ValueError):
        return None
    entry = next((f for f in frames if f.get("frame") == frame_index), None)
    if not entry:
        return None
    depth = cv2.imdecode(np.fromfile(depth_path, np.uint8), cv2.IMREAD_GRAYSCALE)
    h, w = depth.shape[:2]
    samples: list[int] = []
    for person in entry.get("people", []):
        pts = person.get("keypoints", [])
        scores = person.get("scores", [])
        for i, (x, y) in enumerate(pts):
            if (scores[i] if i < len(scores) else 1.0) <= score_thr:
                continue
            xi, yi = int(round(x)), int(round(y))
            if 0 <= xi < w and 0 <= yi < h:
                samples.append(int(depth[yi, xi]))
    if len(samples) < 3:
        return None
    return float(np.median(samples)) / 255.0


def resolve_focal_plane(lens: dict, shot_dir: Path, frame_index: int) -> float | None:
    """Focal plane for a frame: the person's depth (from pose) when following the
    subject, falling back to the segments if nobody is detected; else segment-based."""
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
    scale = focal/min_focal so the widest segment shows the full frame."""
    zoom = lens["zoom"]
    segs = zoom["segments"]
    if not zoom["enabled"] or not _within_span(segs, frame):
        return None
    mms = [focal_mm(s.get("focal")) or 35 for s in segs]
    base = min(mms)
    enriched = [
        {"start": s["start"], "end": s["end"], "scale": mm / base,
         "cx": s.get("cx", 0.5), "cy": s.get("cy", 0.5)}
        for s, mm in zip(segs, mms)
    ]
    scale = segment_value_at(enriched, frame, "scale", "smooth")
    cx = segment_value_at(enriched, frame, "cx", "smooth")
    cy = segment_value_at(enriched, frame, "cy", "smooth")
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


def _depth_label(seg: dict) -> str:
    label = (seg.get("label") or "").strip()
    if label:
        return label
    d = float(seg.get("depth", 0.5))
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
    elif focus["enabled"] and focus["segments"]:
        segs = focus["segments"]
        if len(segs) == 1:
            phrases.append(f"sharp focus on {_depth_label(segs[0])}")
        else:
            phrases.append(f"rack focus from {_depth_label(segs[0])} to {_depth_label(segs[-1])}")

    zoom = lens["zoom"]
    focal_options = {o["key"]: o["fragment"] for o in mappings.get("focal_lengths", [])}
    zoom_segs = zoom["segments"] if zoom["enabled"] else []
    focals = [s.get("focal") for s in zoom_segs if s.get("focal")]
    zoom_changes = len(zoom_segs) >= 2 and len(set(focals)) >= 2

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
            raise RuntimeError("Focus is off — add a focus segment or enable follow-subject")

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

            # Zoom is baked in only at export; the preview stays un-cropped.
            # Outside the focus span there is no DoF — the frame is left sharp.
            d0 = resolve_focal_plane(lens, shot_dir, i)
            if d0 is None:
                dof, fmap = frame, np.full(depth.shape[:2], 255, np.uint8)
            else:
                dof, fmap = render_dof(frame, depth, d0, max_blur, falloff)
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
    """On-demand preview of one frame with the depth-of-field applied. Zoom is
    NOT cropped in here — the preview stays full-frame so the on-image zoom
    framing/center overlay reads true; the crop is baked in only at export."""
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
    return frame
