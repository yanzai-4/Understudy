"""Layout channel API: the shared ADE20K asset (classes/palettes/groups) and
the per-shot group toggles that decide what the exported maps keep."""

import re

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.shots import get_shot_or_404
from app.db import get_db
from app.extractors.layout import load_ade20k
from app.models import LayoutState

router = APIRouter(tags=["layout"])

DEFAULT_STATE: dict = {"selected_instances": None, "disabled_backdrop": [], "manual_subjects": []}

MANUAL_GROUPS = ("building", "props", "vehicle", "person", "animal")
_MANUAL_ID_RE = re.compile(r"^m\d+$")


def _selected_ids(values) -> list[int | str]:
    """Selection ids: detected subjects are ints, manual subjects are 'm<n>'."""
    out: list[int | str] = []
    for v in values or []:
        if isinstance(v, bool):
            continue
        if isinstance(v, int):
            out.append(v)
        elif isinstance(v, float) and v.is_integer():
            out.append(int(v))
        elif isinstance(v, str):
            if _MANUAL_ID_RE.match(v):
                out.append(v)
            elif v.lstrip("-").isdigit():
                out.append(int(v))
    return out


def _clamp01(v) -> float:
    return max(0.0, min(1.0, float(v)))


def _normalize_manual(subjects) -> list[dict]:
    out: list[dict] = []
    for raw in subjects or []:
        if not isinstance(raw, dict):
            continue
        sid = raw.get("id")
        if not (isinstance(sid, str) and _MANUAL_ID_RE.match(sid)):
            continue
        poly_raw = raw.get("polygon") or []
        polygon = [
            [_clamp01(p[0]), _clamp01(p[1])]
            for p in poly_raw
            if isinstance(p, (list, tuple)) and len(p) >= 2
        ]
        if len(polygon) < 3:
            continue  # need a real region
        group = raw.get("group")
        if group not in MANUAL_GROUPS:
            group = "building"
        label = str(raw.get("label") or "").strip()[:200]
        out.append({"id": sid, "group": group, "label": label, "polygon": polygon})
    return out


def normalize_layout_state(data: dict | None) -> dict:
    """selected_instances: the director's curated subject set (None = show all,
    covering both detected int ids and manual 'm<n>' ids). disabled_backdrop ⊆
    {top, bottom}. manual_subjects: director-drawn lasso regions."""
    data = data or {}
    sel = data.get("selected_instances")
    selected = _selected_ids(sel) if sel is not None else None
    backdrop = [b for b in data.get("disabled_backdrop", []) if b in ("top", "bottom")]
    manual = _normalize_manual(data.get("manual_subjects"))
    return {"selected_instances": selected, "disabled_backdrop": backdrop, "manual_subjects": manual}


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
