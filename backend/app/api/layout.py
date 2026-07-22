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

DEFAULT_STATE: dict = {"selected_instances": None, "disabled_backdrop": []}


def _int_ids(values) -> list[int]:
    return [
        int(i) for i in (values or [])
        if isinstance(i, (int, float, str)) and str(i).lstrip("-").isdigit()
    ]


def normalize_layout_state(data: dict | None) -> dict:
    """selected_instances: the director's curated subject set (None = follow the
    tool's auto proposal). disabled_backdrop ⊆ {top, bottom}."""
    data = data or {}
    sel = data.get("selected_instances")
    selected = _int_ids(sel) if sel is not None else None
    backdrop = [b for b in data.get("disabled_backdrop", []) if b in ("top", "bottom")]
    return {"selected_instances": selected, "disabled_backdrop": backdrop}


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
