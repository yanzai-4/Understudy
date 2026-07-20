from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.api.deps import api_error
from app.config import settings
from app.db import get_db
from app.models import CameraParams, Film, Shot
from app.schemas import (
    Page,
    SceneGroup,
    ShotCreate,
    ShotDuplicate,
    ShotGroups,
    ShotOut,
    ShotUpdate,
)
from app.services import paths

router = APIRouter(tags=["shots"])

CAMERA_PARAM_FIELDS = [
    "shot_size",
    "camera_angle",
    "focal_length",
    "aperture",
    "camera_move",
    "light_position",
    "light_quality",
    "light_mood",
    "time_ambience",
    "weather",
    "color_grade",
    "style_suffix",
    "subject_desc",
    "scene_desc",
    "custom_positive",
    "custom_negative",
]


def shot_out(shot: Shot) -> ShotOut:
    out = ShotOut.model_validate(shot)
    out.thumbnail_url = paths.thumbnail_url(shot.film_id, shot.id)
    return out


def get_shot_or_404(db: Session, shot_id: str) -> Shot:
    shot = db.get(Shot, shot_id)
    if shot is None:
        raise api_error(404, "shot_not_found", f"Shot {shot_id} does not exist")
    return shot


def _tag_filter_clause(index: int) -> str:
    return (
        "EXISTS (SELECT 1 FROM json_each(shots.tags) AS je"
        f" WHERE je.value = :tag{index})"
    )


def new_camera_params(shot_id: str, film: Film) -> CameraParams:
    """Camera params for a new shot, seeded from the film's style preset."""
    params = CameraParams(shot_id=shot_id)
    preset = film.default_camera_params or {}
    for field in CAMERA_PARAM_FIELDS:
        if field in preset and preset[field] is not None:
            setattr(params, field, preset[field])
    return params


def _filtered_shot_query(
    film_id: str,
    search: str,
    scene_no: int | None,
    status: str,
    version: int | None,
    picked: bool,
    tags: list[str],
):
    query = select(Shot).where(Shot.film_id == film_id)
    if search.strip():
        like = f"%{search.strip()}%"
        query = query.where(or_(Shot.name.like(like), Shot.notes.like(like)))
    if scene_no is not None:
        query = query.where(Shot.scene_no == scene_no)
    if status:
        query = query.where(Shot.status == status)
    if version is not None:
        query = query.where(Shot.version == version)
    if picked:
        query = query.where(Shot.is_picked.is_(True))
    for i, tag in enumerate(tags):
        query = query.where(text(_tag_filter_clause(i)).bindparams(**{f"tag{i}": tag}))
    return query


@router.get("/films/{film_id}/shots", response_model=Page[ShotOut])
def list_shots(
    film_id: str,
    search: str = "",
    scene_no: int | None = Query(None, ge=0),
    status: str = Query("", pattern="^(draft|extracted|exported)?$"),
    version: int | None = Query(None, ge=1),
    picked: bool = False,
    tags: list[str] = Query([]),
    sort: str = Query("scene", pattern="^(scene|updated|created)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    if db.get(Film, film_id) is None:
        raise api_error(404, "film_not_found", f"Film {film_id} does not exist")

    page_size = page_size or settings.default_page_size
    page_size = min(page_size, settings.max_page_size)

    query = _filtered_shot_query(film_id, search, scene_no, status, version, picked, tags)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0

    if sort == "scene":
        # NULL scenes last, then by scene, then by version.
        query = query.order_by(
            Shot.scene_no.is_(None), Shot.scene_no.asc(), Shot.version.asc(), Shot.created_at.asc()
        )
    elif sort == "updated":
        query = query.order_by(Shot.updated_at.desc())
    else:
        query = query.order_by(Shot.created_at.desc())

    rows = db.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
    return Page(items=[shot_out(s) for s in rows], total=total, page=page, page_size=page_size)


@router.get("/films/{film_id}/shots/grouped", response_model=ShotGroups)
def list_shots_grouped(
    film_id: str,
    search: str = "",
    scene_no: int | None = Query(None, ge=0),
    status: str = Query("", pattern="^(draft|extracted|exported)?$"),
    version: int | None = Query(None, ge=1),
    picked: bool = False,
    tags: list[str] = Query([]),
    db: Session = Depends(get_db),
):
    """Storyboard view: every matching shot grouped by scene_no (ungrouped last)."""
    if db.get(Film, film_id) is None:
        raise api_error(404, "film_not_found", f"Film {film_id} does not exist")

    query = _filtered_shot_query(film_id, search, scene_no, status, version, picked, tags)
    query = query.order_by(
        Shot.scene_no.is_(None), Shot.scene_no.asc(), Shot.version.asc(), Shot.created_at.asc()
    )
    rows = db.scalars(query).all()

    groups: list[SceneGroup] = []
    current_key: object = object()
    for shot in rows:
        if shot.scene_no != current_key:
            current_key = shot.scene_no
            groups.append(SceneGroup(scene_no=shot.scene_no, shots=[]))
        groups[-1].shots.append(shot_out(shot))
    return ShotGroups(groups=groups, total=len(rows))


@router.post("/films/{film_id}/shots", response_model=ShotOut)
def create_shot(film_id: str, body: ShotCreate, db: Session = Depends(get_db)):
    film = db.get(Film, film_id)
    if film is None:
        raise api_error(404, "film_not_found", f"Film {film_id} does not exist")

    shot = Shot(
        film_id=film_id,
        name=body.name.strip(),
        scene_no=body.scene_no,
        tags=sorted({t.strip() for t in body.tags if t.strip()}),
        notes=body.notes,
    )
    db.add(shot)
    db.flush()
    db.add(new_camera_params(shot.id, film))
    db.commit()
    paths.ensure_shot_dirs(film_id, shot.id)
    return shot_out(shot)


@router.get("/shots/{shot_id}", response_model=ShotOut)
def get_shot(shot_id: str, db: Session = Depends(get_db)):
    return shot_out(get_shot_or_404(db, shot_id))


@router.patch("/shots/{shot_id}", response_model=ShotOut)
def update_shot(shot_id: str, body: ShotUpdate, db: Session = Depends(get_db)):
    shot = get_shot_or_404(db, shot_id)
    data = body.model_dump(exclude_unset=True)

    if data.pop("clear_scene_no", False):
        shot.scene_no = None
        data.pop("scene_no", None)
    if "name" in data and data["name"]:
        shot.name = data["name"].strip()
        data.pop("name")
    if "tags" in data and data["tags"] is not None:
        shot.tags = sorted({t.strip() for t in data.pop("tags") if t.strip()})
    for field in ("scene_no", "version", "notes", "is_picked"):
        if field in data and data[field] is not None:
            setattr(shot, field, data[field])
    db.commit()
    return shot_out(shot)


@router.post("/shots/{shot_id}/duplicate", response_model=ShotOut)
def duplicate_shot_endpoint(shot_id: str, body: ShotDuplicate, db: Session = Depends(get_db)):
    from app.services.shot_ops import duplicate_shot

    source = get_shot_or_404(db, shot_id)
    clone = duplicate_shot(db, source, body.as_new_version)
    return shot_out(clone)


@router.delete("/shots/{shot_id}", status_code=204)
def delete_shot(shot_id: str, db: Session = Depends(get_db)):
    shot = get_shot_or_404(db, shot_id)
    film_id = shot.film_id
    db.delete(shot)
    db.commit()
    paths.delete_shot_dir(film_id, shot_id)
