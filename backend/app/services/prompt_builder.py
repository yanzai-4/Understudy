"""Camera-parameter → prompt assembly.

The algorithm is deliberately trivial and data-driven (ordered fragments joined
by ", ") so the frontend's live preview (lib/promptCompose.ts) can mirror it
exactly. Any change here must be mirrored there.
"""

import json
from functools import lru_cache

from app.config import settings


def layout_labels(manual_subjects: list[dict] | None) -> list[str]:
    """Director-drawn manual-subject labels for the prompt: trimmed, non-empty,
    de-duplicated, order preserved."""
    seen: set[str] = set()
    out: list[str] = []
    for subj in manual_subjects or []:
        label = str(subj.get("label") or "").strip()
        if label and label not in seen:
            seen.add(label)
            out.append(label)
    return out


DIMENSION_KEYS = [
    "shot_size",
    "camera_angle",
    "focal_length",  # legacy column; the dimension now lives in the lens step
    "aperture",
    "shutter",
    "camera_move",
    "light_position",
    "light_quality",
    "light_mood",
    "time_ambience",
    "weather",
    "color_grade",
    "style_suffix",
]


@lru_cache(maxsize=1)
def _load_cached(mtime_key: tuple) -> dict:
    path = (
        settings.user_mappings_path
        if settings.user_mappings_path.exists()
        else settings.builtin_mappings_path
    )
    return json.loads(path.read_text(encoding="utf-8"))


def load_mappings() -> dict:
    """User override (data/prompt_mappings.json) wins over the builtin table."""
    user = settings.user_mappings_path
    builtin = settings.builtin_mappings_path
    mtime_key = (
        user.stat().st_mtime if user.exists() else None,
        builtin.stat().st_mtime,
    )
    return _load_cached(mtime_key)


def compose(
    params: dict,
    mappings: dict | None = None,
    lens_phrases: list[str] | None = None,
    scene_elements: list[str] | None = None,
) -> tuple[str, str]:
    """Returns (positive, negative). `params` holds camera_params column values;
    `lens_phrases` are focus/zoom fragments from services.lens.lens_phrases;
    `scene_elements` are manual-subject labels joined after scene_desc."""
    mappings = mappings or load_mappings()

    fragment_by_dim_option: dict[tuple[str, str], str] = {}
    for dim in mappings["dimensions"]:
        for opt in dim["options"]:
            fragment_by_dim_option[(dim["key"], opt["key"])] = opt["fragment"]

    parts: list[str] = []
    for free_text in (params.get("subject_desc"), params.get("scene_desc")):
        text = (free_text or "").strip()
        if text:
            parts.append(text)

    parts.extend(scene_elements or [])
    parts.extend(lens_phrases or [])

    for dim in sorted(mappings["dimensions"], key=lambda d: d["order"]):
        selected = params.get(dim["key"])
        if not selected:
            continue
        fragment = fragment_by_dim_option.get((dim["key"], selected))
        if fragment:
            parts.append(fragment)

    custom = (params.get("custom_positive") or "").strip()
    if custom:
        parts.append(custom)

    positive = ", ".join(parts)

    negative_parts = [mappings.get("negative_default", "").strip()]
    custom_negative = (params.get("custom_negative") or "").strip()
    if custom_negative:
        negative_parts.append(custom_negative)
    negative = ", ".join(p for p in negative_parts if p)

    return positive, negative
