import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import api_error
from app.api.shots import get_shot_or_404, shot_out
from app.config import settings
from app.db import get_db
from app.schemas import ShotOut
from app.services import paths, video_io

router = APIRouter(tags=["uploads"])

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
CHUNK = 4 * 1024 * 1024


def _clear_extraction_products(film_id: str, shot_id: str) -> None:
    base = paths.shot_dir(film_id, shot_id)
    for sub in ("frames", "pose", "depth", "layout", "blockout", "masks"):
        shutil.rmtree(base / sub, ignore_errors=True)
        (base / sub).mkdir(parents=True, exist_ok=True)


@router.post("/shots/{shot_id}/video", response_model=ShotOut)
def upload_video(shot_id: str, file: UploadFile, db: Session = Depends(get_db)):
    shot = get_shot_or_404(db, shot_id)

    ext = Path(file.filename or "video.mp4").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise api_error(400, "unsupported_format", f"Unsupported video format: {ext}")

    base = paths.ensure_shot_dirs(shot.film_id, shot.id)
    source_dir = base / "source"
    shutil.rmtree(source_dir, ignore_errors=True)
    source_dir.mkdir(parents=True, exist_ok=True)
    dest = source_dir / f"source{ext}"

    written = 0
    with dest.open("wb") as out:
        while chunk := file.file.read(CHUNK):
            written += len(chunk)
            if written > settings.max_upload_bytes:
                out.close()
                dest.unlink(missing_ok=True)
                raise api_error(413, "file_too_large", "Video exceeds the 2 GB upload limit")
            out.write(chunk)
    if written == 0:
        dest.unlink(missing_ok=True)
        raise api_error(400, "empty_file", "Uploaded file is empty")

    try:
        info = video_io.probe(dest)
    except video_io.VideoOpenError as exc:
        dest.unlink(missing_ok=True)
        raise api_error(422, "undecodable_video", str(exc))

    video_io.make_thumbnail(dest, paths.thumbnail_path(shot.film_id, shot.id))

    # Re-upload invalidates prior extraction results.
    _clear_extraction_products(shot.film_id, shot.id)
    shot.source_filename = file.filename
    shot.video_width = info.width
    shot.video_height = info.height
    shot.video_fps = info.fps
    shot.video_frame_count = info.frame_count
    shot.video_duration_sec = info.duration_sec
    shot.extract_stride = None
    shot.extract_max_size = None
    shot.extract_frame_count = None
    shot.extracted_channels = None
    shot.status = "draft"
    db.commit()
    return shot_out(shot)


def find_source_video(film_id: str, shot_id: str) -> Path | None:
    source_dir = paths.shot_dir(film_id, shot_id) / "source"
    if not source_dir.exists():
        return None
    for f in source_dir.iterdir():
        if f.suffix.lower() in ALLOWED_EXTENSIONS:
            return f
    return None
