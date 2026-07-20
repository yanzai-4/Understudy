from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import api_error
from app.api.shots import get_shot_or_404
from app.api.uploads import find_source_video
from app.db import get_db
from app.extractors import EXTRACTOR_REGISTRY
from app.services.pipeline import load_extraction_meta, run_extraction
from app.services.task_registry import registry

router = APIRouter(tags=["extraction"])


class ExtractRequest(BaseModel):
    channels: list[str] = ["pose", "depth", "canny"]
    stride: int | Literal["auto"] = "auto"
    max_size: int = Field(768, ge=256, le=1920)


@router.get("/system/extractors")
def list_extractors() -> list[dict]:
    return [
        {"name": name, "requires_models": cls.requires_models}
        for name, cls in EXTRACTOR_REGISTRY.items()
    ]


@router.post("/shots/{shot_id}/extract")
def start_extraction(
    shot_id: str,
    body: ExtractRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    shot = get_shot_or_404(db, shot_id)
    if find_source_video(shot.film_id, shot.id) is None:
        raise api_error(400, "no_video", "Upload a video before extracting")
    if not body.channels:
        raise api_error(400, "no_channels", "Select at least one channel to extract")
    unknown = [c for c in body.channels if c not in EXTRACTOR_REGISTRY]
    if unknown:
        raise api_error(400, "unknown_channels", f"Unknown channels: {', '.join(unknown)}")
    if isinstance(body.stride, int) and body.stride < 1:
        raise api_error(400, "bad_stride", "Stride must be >= 1")
    if registry.has_active("extract"):
        raise api_error(409, "extraction_busy", "Another extraction is already running")

    task_id = registry.create("extract")
    background.add_task(run_extraction, task_id, shot_id, body.channels, body.stride, body.max_size)
    return {"task_id": task_id}


@router.get("/shots/{shot_id}/extraction")
def get_extraction(shot_id: str, db: Session = Depends(get_db)):
    shot = get_shot_or_404(db, shot_id)
    meta = load_extraction_meta(shot.film_id, shot.id)
    if meta is None:
        raise api_error(404, "not_extracted", "This shot has not been extracted yet")
    # Trim the potentially large index_map from the default payload; clients
    # that need exact timestamps can read it from the export metadata.
    return {k: v for k, v in meta.items() if k != "index_map"}
