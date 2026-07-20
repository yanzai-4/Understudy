"""Video decoding/probing built on OpenCV (MSMF), with imageio-ffmpeg fallback
for codecs MSMF cannot open, plus JPEG thumbnail generation."""

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np


@dataclass
class VideoInfo:
    width: int
    height: int
    fps: float
    frame_count: int
    duration_sec: float


class VideoOpenError(Exception):
    pass


def _probe_cv2(path: Path) -> VideoInfo | None:
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            return None
        ok, _ = cap.read()
        if not ok:
            return None
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if width <= 0 or height <= 0 or frame_count <= 0:
            return None
        return VideoInfo(width, height, fps, frame_count, frame_count / fps)
    finally:
        cap.release()


def _probe_ffmpeg(path: Path) -> VideoInfo | None:
    try:
        import imageio_ffmpeg

        reader = imageio_ffmpeg.read_frames(str(path))
        meta = reader.__next__()
        reader.close()
        width, height = meta["size"]
        fps = float(meta.get("fps") or 30.0)
        duration = float(meta.get("duration") or 0.0)
        frame_count = int(duration * fps)
        if frame_count <= 0:
            return None
        return VideoInfo(int(width), int(height), fps, frame_count, duration)
    except Exception:
        return None


def probe(path: Path) -> VideoInfo:
    info = _probe_cv2(path) or _probe_ffmpeg(path)
    if info is None:
        raise VideoOpenError(f"Cannot decode video: {path.name}")
    return info


def iter_frames(path: Path) -> Iterator[np.ndarray]:
    """Yield BGR frames. Prefers OpenCV; falls back to the ffmpeg pipe."""
    cap = cv2.VideoCapture(str(path))
    if cap.isOpened():
        ok, frame = cap.read()
        if ok:
            yield frame
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                yield frame
            cap.release()
            return
    cap.release()

    import imageio_ffmpeg

    reader = imageio_ffmpeg.read_frames(str(path))
    meta = reader.__next__()
    width, height = meta["size"]
    for raw in reader:
        rgb = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3))
        yield cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def resize_long_edge(frame: np.ndarray, max_size: int) -> np.ndarray:
    """Cap the long edge at max_size and force even dimensions (H.264-friendly)."""
    h, w = frame.shape[:2]
    scale = min(1.0, max_size / max(h, w))
    new_w = max(2, int(w * scale) // 2 * 2)
    new_h = max(2, int(h * scale) // 2 * 2)
    if (new_w, new_h) == (w, h):
        return frame
    return cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)


def make_thumbnail(video_path: Path, out_path: Path, width: int = 480) -> bool:
    """Write a JPEG thumbnail from ~10% into the video."""
    info = probe(video_path)
    target_index = max(0, int(info.frame_count * 0.1))
    frame = None
    for i, f in enumerate(iter_frames(video_path)):
        frame = f
        if i >= target_index:
            break
    if frame is None:
        return False
    h, w = frame.shape[:2]
    scale = width / w
    thumb = cv2.resize(frame, (width, max(2, int(h * scale))), interpolation=cv2.INTER_AREA)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    return imwrite_unicode(out_path, thumb)


def imwrite_unicode(path: Path, image: np.ndarray, quality: int = 85) -> bool:
    """cv2.imwrite fails on non-ASCII Windows paths; encode + tofile is safe."""
    ext = path.suffix if path.suffix else ".jpg"
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if ext.lower() in (".jpg", ".jpeg") else []
    ok, buf = cv2.imencode(ext, image, params)
    if not ok:
        return False
    buf.tofile(str(path))
    return True
