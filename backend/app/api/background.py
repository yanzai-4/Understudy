from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import api_error
from app.api.shots import get_shot_or_404
from app.db import get_db
from app.models import BackgroundEdit
from app.schemas import EditType
from app.services import paths
from app.services.mask_renderer import delete_masks, render_masks

router = APIRouter(tags=["background"])


class EditCreate(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    edit_type: EditType
    description: str = ""
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(gt=0.0, le=1.0)
    h: float = Field(gt=0.0, le=1.0)


class EditUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=200)
    edit_type: EditType | None = None
    description: str | None = None
    x: float | None = Field(default=None, ge=0.0, le=1.0)
    y: float | None = Field(default=None, ge=0.0, le=1.0)
    w: float | None = Field(default=None, gt=0.0, le=1.0)
    h: float | None = Field(default=None, gt=0.0, le=1.0)


def _edit_out(edit: BackgroundEdit, film_id: str, shot_id: str) -> dict:
    return {
        "id": edit.id,
        "shot_id": edit.shot_id,
        "label": edit.label,
        "edit_type": edit.edit_type,
        "description": edit.description,
        "x": edit.x,
        "y": edit.y,
        "w": edit.w,
        "h": edit.h,
        "mask_url": paths.file_url(film_id, shot_id, *edit.mask_path.split("/")) if edit.mask_path else None,
        "sort_order": edit.sort_order,
    }


@router.get("/shots/{shot_id}/background-edits")
def list_edits(shot_id: str, db: Session = Depends(get_db)) -> list[dict]:
    shot = get_shot_or_404(db, shot_id)
    edits = (
        db.query(BackgroundEdit)
        .filter(BackgroundEdit.shot_id == shot_id)
        .order_by(BackgroundEdit.sort_order, BackgroundEdit.id)
        .all()
    )
    return [_edit_out(e, shot.film_id, shot.id) for e in edits]


@router.post("/shots/{shot_id}/background-edits")
def create_edit(shot_id: str, body: EditCreate, db: Session = Depends(get_db)) -> dict:
    shot = get_shot_or_404(db, shot_id)
    if body.x + body.w > 1.0001 or body.y + body.h > 1.0001:
        raise api_error(400, "box_out_of_bounds", "Box extends outside the frame")
    edit = BackgroundEdit(
        shot_id=shot_id,
        label=body.label.strip(),
        edit_type=body.edit_type,
        description=body.description,
        x=body.x,
        y=body.y,
        w=min(body.w, 1.0 - body.x),
        h=min(body.h, 1.0 - body.y),
    )
    db.add(edit)
    db.flush()
    edit.mask_path = render_masks(shot, edit)
    db.commit()
    return _edit_out(edit, shot.film_id, shot.id)


@router.patch("/background-edits/{edit_id}")
def update_edit(edit_id: int, body: EditUpdate, db: Session = Depends(get_db)) -> dict:
    edit = db.get(BackgroundEdit, edit_id)
    if edit is None:
        raise api_error(404, "edit_not_found", f"Background edit {edit_id} does not exist")
    shot = get_shot_or_404(db, edit.shot_id)

    data = body.model_dump(exclude_unset=True)
    box_changed = any(k in data for k in ("x", "y", "w", "h"))
    for key, value in data.items():
        if value is not None:
            setattr(edit, key, value)
    if box_changed:
        edit.w = min(edit.w, 1.0 - edit.x)
        edit.h = min(edit.h, 1.0 - edit.y)
        edit.mask_path = render_masks(shot, edit)
    db.commit()
    return _edit_out(edit, shot.film_id, shot.id)


@router.delete("/background-edits/{edit_id}", status_code=204)
def delete_edit(edit_id: int, db: Session = Depends(get_db)) -> None:
    edit = db.get(BackgroundEdit, edit_id)
    if edit is None:
        raise api_error(404, "edit_not_found", f"Background edit {edit_id} does not exist")
    shot = get_shot_or_404(db, edit.shot_id)
    delete_masks(shot, edit.id)
    db.delete(edit)
    db.commit()
