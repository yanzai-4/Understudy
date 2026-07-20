import cv2
from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import api_error
from app.api.shots import get_shot_or_404
from app.db import get_db
from app.models import LensState
from app.services import paths
from app.services.lens import DEFAULT_LENS, normalize_lens, render_single_frame, run_lens_render
from app.services.task_registry import registry

router = APIRouter(tags=["lens"])


class LensUpdate(BaseModel):
    data: dict


class LensPreviewRequest(BaseModel):
    frame: int
    data: dict


@router.get("/shots/{shot_id}/lens")
def get_lens(shot_id: str, db: Session = Depends(get_db)) -> dict:
    get_shot_or_404(db, shot_id)
    state = db.get(LensState, shot_id)
    return normalize_lens(state.data if state else None) if state else dict(DEFAULT_LENS)


@router.put("/shots/{shot_id}/lens")
def put_lens(shot_id: str, body: LensUpdate, db: Session = Depends(get_db)) -> dict:
    get_shot_or_404(db, shot_id)
    data = normalize_lens(body.data)
    state = db.get(LensState, shot_id)
    if state is None:
        db.add(LensState(shot_id=shot_id, data=data))
    else:
        state.data = data
    db.commit()
    return data


@router.post("/shots/{shot_id}/lens/preview")
def lens_preview(shot_id: str, body: LensPreviewRequest, db: Session = Depends(get_db)):
    """Render one frame with the given (possibly unsaved) lens data — used for
    the interactive click-to-focus feedback."""
    shot = get_shot_or_404(db, shot_id)
    frame = render_single_frame(paths.shot_dir(shot.film_id, shot.id), body.data, body.frame)
    if frame is None:
        raise api_error(404, "frame_not_found", f"Frame {body.frame} does not exist")
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        raise api_error(500, "encode_failed", "Failed to encode preview frame")
    return Response(content=buf.tobytes(), media_type="image/jpeg")


@router.post("/shots/{shot_id}/lens/render")
def start_lens_render(shot_id: str, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Render the full dof/ + focus/ sequences as a background task."""
    shot = get_shot_or_404(db, shot_id)
    state = db.get(LensState, shot_id)
    lens = normalize_lens(state.data if state else None)
    if not (lens["focus"]["enabled"] and lens["focus"]["keyframes"]):
        raise api_error(400, "no_focus", "Add at least one focus keyframe first")
    if not (paths.shot_dir(shot.film_id, shot.id) / "depth").exists():
        raise api_error(400, "no_depth", "Depth channel required — extract depth first")
    if registry.has_active("lens_render"):
        raise api_error(409, "render_busy", "Another lens render is already running")

    task_id = registry.create("lens_render")
    background.add_task(run_lens_render, task_id, shot_id)
    return {"task_id": task_id}
