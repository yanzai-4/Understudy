"""Shot duplication: clone the DB row + params + annotations and copy the
extraction products on disk, so a new version can tweak cinematography and
prompt without re-running extraction."""

import shutil

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import BackgroundEdit, CameraParams, LayoutState, LensState, Shot
from app.services import paths
from app.services.mask_renderer import render_masks

COPY_SUBDIRS = ["source", "thumbnail", "frames", "pose", "depth", "layout", "blockout"]
CAMERA_FIELDS = [
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


def duplicate_shot(db: Session, source: Shot, as_new_version: bool) -> Shot:
    if as_new_version:
        max_version = db.scalar(
            select(func.max(Shot.version)).where(
                Shot.film_id == source.film_id,
                Shot.name == source.name,
                Shot.scene_no.is_(source.scene_no) if source.scene_no is None
                else Shot.scene_no == source.scene_no,
            )
        )
        name = source.name
        version = (max_version or source.version) + 1
    else:
        name = f"{source.name} (copy)"
        version = 1

    clone = Shot(
        film_id=source.film_id,
        name=name,
        scene_no=source.scene_no,
        version=version,
        tags=list(source.tags or []),
        is_picked=False,
        notes=source.notes,
        # Exports are not cloned, so an exported source becomes 'extracted'.
        status="extracted" if source.status in ("extracted", "exported") else source.status,
        source_filename=source.source_filename,
        video_width=source.video_width,
        video_height=source.video_height,
        video_fps=source.video_fps,
        video_frame_count=source.video_frame_count,
        video_duration_sec=source.video_duration_sec,
        extract_stride=source.extract_stride,
        extract_max_size=source.extract_max_size,
        extract_frame_count=source.extract_frame_count,
        extracted_channels=list(source.extracted_channels or []) or None,
    )
    db.add(clone)
    db.flush()

    if source.camera_params is not None:
        params = CameraParams(shot_id=clone.id)
        for field in CAMERA_FIELDS:
            setattr(params, field, getattr(source.camera_params, field))
        db.add(params)

    source_lens = db.get(LensState, source.id)
    if source_lens is not None:
        db.add(LensState(shot_id=clone.id, data=source_lens.data))

    source_layout = db.get(LayoutState, source.id)
    if source_layout is not None:
        db.add(LayoutState(shot_id=clone.id, data=source_layout.data))

    # Copy assets (everything except exports; masks are re-rendered for new edit ids).
    src_dir = paths.shot_dir(source.film_id, source.id)
    dst_dir = paths.ensure_shot_dirs(clone.film_id, clone.id)
    for sub in COPY_SUBDIRS:
        if (src_dir / sub).exists():
            shutil.rmtree(dst_dir / sub, ignore_errors=True)
            shutil.copytree(src_dir / sub, dst_dir / sub)
    if (src_dir / "extraction.json").exists():
        shutil.copy2(src_dir / "extraction.json", dst_dir / "extraction.json")

    for edit in source.background_edits:
        new_edit = BackgroundEdit(
            shot_id=clone.id,
            label=edit.label,
            edit_type=edit.edit_type,
            description=edit.description,
            x=edit.x,
            y=edit.y,
            w=edit.w,
            h=edit.h,
            sort_order=edit.sort_order,
        )
        db.add(new_edit)
        db.flush()
        new_edit.mask_path = render_masks(clone, new_edit)

    db.commit()
    return clone
