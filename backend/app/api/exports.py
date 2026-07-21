from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import api_error
from app.api.shots import get_shot_or_404
from app.db import get_db
from app.models import ExportRecord
from app.services import paths
from app.services.exporter import run_export_task
from app.services.pipeline import load_extraction_meta
from app.services.task_registry import registry

router = APIRouter(tags=["exports"])


class ExportInclude(BaseModel):
    source: bool = False
    channels: list[str] | None = None  # None = all extracted
    masks: bool = True
    control_videos: bool = True
    scope: dict[str, str] = {}  # per-channel: "whole" | "subject" (canny/depth)


class ExportRequest(BaseModel):
    include: ExportInclude = ExportInclude()


def _export_out(record: ExportRecord) -> dict:
    return {
        "id": record.id,
        "shot_id": record.shot_id,
        "zip_name": record.zip_path.split("/")[-1].split("\\")[-1],
        "size_bytes": record.size_bytes,
        "created_at": record.created_at,
        "download_url": f"/api/exports/{record.id}/download",
    }


@router.post("/shots/{shot_id}/export")
def start_export(
    shot_id: str,
    body: ExportRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    shot = get_shot_or_404(db, shot_id)
    meta = load_extraction_meta(shot.film_id, shot.id)
    if meta is None:
        raise api_error(400, "not_extracted", "Extract control signals before exporting")
    if registry.has_active("export"):
        raise api_error(409, "export_busy", "Another export is already running")

    include = body.include.model_dump()
    if include["channels"] is None:
        include["channels"] = meta["channels"]

    task_id = registry.create("export")
    background.add_task(run_export_task, task_id, shot_id, include)
    return {"task_id": task_id}


@router.get("/shots/{shot_id}/exports")
def list_exports(shot_id: str, db: Session = Depends(get_db)) -> list[dict]:
    get_shot_or_404(db, shot_id)
    records = (
        db.query(ExportRecord)
        .filter(ExportRecord.shot_id == shot_id)
        .order_by(ExportRecord.id.desc())
        .all()
    )
    return [_export_out(r) for r in records]


@router.get("/exports/{export_id}/download")
def download_export(export_id: int, db: Session = Depends(get_db)):
    record = db.get(ExportRecord, export_id)
    if record is None:
        raise api_error(404, "export_not_found", f"Export {export_id} does not exist")
    shot = get_shot_or_404(db, record.shot_id)
    zip_file = paths.shot_dir(shot.film_id, shot.id) / record.zip_path
    if not zip_file.exists():
        raise api_error(410, "export_file_missing", "Export file was deleted from disk")
    return FileResponse(zip_file, filename=zip_file.name, media_type="application/zip")
