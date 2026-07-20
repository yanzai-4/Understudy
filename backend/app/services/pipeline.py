"""Extraction pipeline: one decode loop feeding every enabled extractor.

Decoding once keeps stride/resize decisions in a single place and avoids
paying the video-decode cost per channel.
"""

import json
import logging
import math
import shutil
import time
import traceback
from pathlib import Path

from app.config import settings
from app.db import SessionLocal
from app.extractors import EXTRACTOR_REGISTRY
from app.extractors.base import ExtractionContext
from app.models import Shot
from app.services import app_settings as app_settings_service
from app.services import paths, video_io
from app.services.task_registry import TaskCancelled, registry

log = logging.getLogger(__name__)

PROGRESS_EVERY_FRAMES = 10
PROGRESS_EVERY_SEC = 0.5


def compute_stride(frame_count: int, stride_option: int | str) -> int:
    if isinstance(stride_option, int) and stride_option >= 1:
        return stride_option
    return max(1, math.ceil(frame_count / settings.auto_stride_target_frames))


def run_extraction(
    task_id: str,
    shot_id: str,
    channels: list[str],
    stride_option: int | str,
    max_size: int,
) -> None:
    """Background job. Owns its own DB session (runs in a worker thread)."""
    db = SessionLocal()
    try:
        registry.start(task_id)
        shot = db.get(Shot, shot_id)
        if shot is None:
            raise RuntimeError(f"Shot {shot_id} no longer exists")

        source = _find_source(shot)
        if source is None:
            raise RuntimeError("No source video uploaded")

        info = video_io.probe(source)
        stride = compute_stride(info.frame_count, stride_option)
        expected_out = math.ceil(info.frame_count / stride)
        effective_fps = info.fps / stride

        shot_dir = paths.shot_dir(shot.film_id, shot.id)
        app_config = app_settings_service.get_all(db)

        ctx = ExtractionContext(
            shot_dir=shot_dir,
            out_size=(0, 0),  # set after the first frame is resized
            stride=stride,
            effective_fps=effective_fps,
            total_out_frames=expected_out,
            ort_provider=str(app_config.get("ort_provider", "cpu")),
            models_dir=settings.models_dir,
            app_settings=app_config,
            is_cancelled=lambda: registry.is_cancel_requested(task_id),
        )

        # Fresh output dirs so a re-run never mixes frames from different settings.
        frames_dir = shot_dir / "frames"
        shutil.rmtree(frames_dir, ignore_errors=True)
        frames_dir.mkdir(parents=True, exist_ok=True)
        extractors = []
        for name in channels:
            cls = EXTRACTOR_REGISTRY.get(name)
            if cls is None:
                raise RuntimeError(f"Unknown extractor: {name}")
            shutil.rmtree(shot_dir / name, ignore_errors=True)
            extractors.append(cls())

        # Fallback: download any required-but-missing models (setup.ps1 normally
        # pre-downloads them, so this is usually a no-op).
        from app.services import model_manager

        registry.set_progress(task_id, 0.0, "downloading_models")
        model_manager.ensure_models(
            channels,
            str(app_config.get("depth_model_variant", "int8")),
            lambda p, stage: registry.set_progress(task_id, 0.0, "downloading_models"),
        )

        registry.set_progress(task_id, 0.0, "loading_models")
        for ex in extractors:
            ex.prepare(ctx)

        index_map: list[dict] = []
        out_index = 0
        last_report = 0.0
        for src_index, frame in enumerate(video_io.iter_frames(source)):
            if src_index % stride:
                continue
            if ctx.is_cancelled():
                raise TaskCancelled()

            frame = video_io.resize_long_edge(frame, max_size)
            if out_index == 0:
                h, w = frame.shape[:2]
                ctx.out_size = (w, h)

            video_io.imwrite_unicode(frames_dir / f"frame_{out_index:06d}.jpg", frame, quality=85)
            for ex in extractors:
                ex.process_frame(frame, out_index, ctx)

            index_map.append(
                {"out": out_index, "src": src_index, "t": round(src_index / info.fps, 4)}
            )
            out_index += 1

            now = time.monotonic()
            if out_index % PROGRESS_EVERY_FRAMES == 0 or now - last_report > PROGRESS_EVERY_SEC:
                last_report = now
                registry.set_progress(
                    task_id,
                    out_index / max(1, expected_out),
                    f"extract {out_index}/{expected_out}",
                )

        if out_index == 0:
            raise RuntimeError("No frames decoded from source video")

        registry.set_progress(task_id, 1.0, "finalizing")
        summaries = {ex.name: ex.finalize(ctx) for ex in extractors}

        extraction_meta = {
            "schema_version": 1,
            "stride": stride,
            "max_size": max_size,
            "output_size": list(ctx.out_size),
            "effective_fps": round(effective_fps, 4),
            "frame_count": out_index,
            "channels": channels,
            "index_map": index_map,
            "summaries": summaries,
            "source": {
                "width": info.width,
                "height": info.height,
                "fps": info.fps,
                "frame_count": info.frame_count,
            },
        }
        (shot_dir / "extraction.json").write_text(
            json.dumps(extraction_meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        shot.extract_stride = stride
        shot.extract_max_size = max_size
        shot.extract_frame_count = out_index
        shot.extracted_channels = channels
        if shot.status == "draft":
            shot.status = "extracted"
        db.commit()

        registry.finish(task_id, {"frame_count": out_index, "channels": channels})
    except TaskCancelled:
        registry.mark_cancelled(task_id)
        log.info("Extraction task %s cancelled", task_id)
    except Exception as exc:  # surface anything to the UI
        log.error("Extraction task %s failed:\n%s", task_id, traceback.format_exc())
        registry.fail(task_id, str(exc))
    finally:
        db.close()


def _find_source(shot: Shot) -> Path | None:
    from app.api.uploads import find_source_video

    return find_source_video(shot.film_id, shot.id)


def load_extraction_meta(film_id: str, shot_id: str) -> dict | None:
    meta_path = paths.shot_dir(film_id, shot_id) / "extraction.json"
    if not meta_path.exists():
        return None
    return json.loads(meta_path.read_text(encoding="utf-8"))
