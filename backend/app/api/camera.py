from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.shots import CAMERA_PARAM_FIELDS, get_shot_or_404
from app.db import get_db
from app.models import CameraParams, PromptRecord
from app.services.prompt_builder import compose, load_mappings

router = APIRouter(tags=["camera"])


class CameraParamsUpdate(BaseModel):
    shot_size: str | None = None
    camera_angle: str | None = None
    focal_length: str | None = None
    aperture: str | None = None
    camera_move: str | None = None
    light_position: str | None = None
    light_quality: str | None = None
    light_mood: str | None = None
    time_ambience: str | None = None
    weather: str | None = None
    color_grade: str | None = None
    style_suffix: str | None = None
    subject_desc: str = ""
    scene_desc: str = ""
    custom_positive: str = ""
    custom_negative: str = ""


def _params_dict(params: CameraParams | None) -> dict:
    if params is None:
        return {field: None for field in CAMERA_PARAM_FIELDS}
    return {field: getattr(params, field) for field in CAMERA_PARAM_FIELDS}


def get_or_create_params(db: Session, shot_id: str) -> CameraParams:
    params = db.query(CameraParams).filter(CameraParams.shot_id == shot_id).one_or_none()
    if params is None:
        params = CameraParams(shot_id=shot_id)
        db.add(params)
        db.flush()
    return params


@router.get("/prompt-mappings")
def get_prompt_mappings() -> dict:
    return load_mappings()


@router.get("/shots/{shot_id}/camera-params")
def get_camera_params(shot_id: str, db: Session = Depends(get_db)) -> dict:
    get_shot_or_404(db, shot_id)
    params = db.query(CameraParams).filter(CameraParams.shot_id == shot_id).one_or_none()
    return _params_dict(params)


@router.put("/shots/{shot_id}/camera-params")
def put_camera_params(shot_id: str, body: CameraParamsUpdate, db: Session = Depends(get_db)) -> dict:
    get_shot_or_404(db, shot_id)
    params = get_or_create_params(db, shot_id)
    for field, value in body.model_dump().items():
        setattr(params, field, value)
    db.commit()
    return _params_dict(params)


@router.post("/shots/{shot_id}/prompt")
def generate_prompt(shot_id: str, db: Session = Depends(get_db)) -> dict:
    """Authoritative prompt generation, persisted as a history snapshot."""
    from app.models import LensState
    from app.services.lens import lens_phrases

    get_shot_or_404(db, shot_id)
    params = get_or_create_params(db, shot_id)
    snapshot = _params_dict(params)

    mappings = load_mappings()
    lens_state = db.get(LensState, shot_id)
    phrases = lens_phrases(
        lens_state.data if lens_state else {}, mappings, camera_move_set=bool(snapshot.get("camera_move"))
    )

    positive, negative = compose(snapshot, mappings, phrases)
    record = PromptRecord(
        shot_id=shot_id,
        positive_prompt=positive,
        negative_prompt=negative,
        params_snapshot={**snapshot, "lens_phrases": phrases},
    )
    db.add(record)
    db.commit()
    return {"id": record.id, "positive": positive, "negative": negative}
