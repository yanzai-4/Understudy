"""Layout channel API: the shared ADE20K asset (classes/palettes/groups) and
the per-shot group toggles that decide what the exported maps keep."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.shots import get_shot_or_404
from app.db import get_db
from app.extractors.layout import load_ade20k
from app.models import LayoutState

router = APIRouter(tags=["layout"])

DEFAULT_STATE: dict = {"disabled_groups": [], "disabled_instances": [], "disabled_backdrop": []}


def normalize_layout_state(data: dict | None) -> dict:
    valid = set(load_ade20k()["group_order"])
    data = data or {}
    disabled = [g for g in data.get("disabled_groups", []) if g in valid]
    instances = [int(i) for i in data.get("disabled_instances", []) if isinstance(i, (int, float, str)) and str(i).lstrip("-").isdigit()]
    backdrop = [b for b in data.get("disabled_backdrop", []) if b in ("top", "bottom")]
    return {"disabled_groups": disabled, "disabled_instances": instances, "disabled_backdrop": backdrop}


class LayoutUpdate(BaseModel):
    data: dict


@router.get("/layout/ade20k")
def get_ade20k_asset() -> dict:
    """Class names, both palettes and group mapping — the frontend renders
    layout previews from ids with this exact table (BE/FE parity)."""
    return load_ade20k()


@router.get("/shots/{shot_id}/layout")
def get_layout_state(shot_id: str, db: Session = Depends(get_db)) -> dict:
    get_shot_or_404(db, shot_id)
    state = db.get(LayoutState, shot_id)
    return normalize_layout_state(state.data if state else None)


@router.put("/shots/{shot_id}/layout")
def put_layout_state(shot_id: str, body: LayoutUpdate, db: Session = Depends(get_db)) -> dict:
    get_shot_or_404(db, shot_id)
    data = normalize_layout_state(body.data)
    state = db.get(LayoutState, shot_id)
    if state is None:
        db.add(LayoutState(shot_id=shot_id, data=data))
    else:
        state.data = data
    db.commit()
    return data
