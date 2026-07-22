import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Film(Base):
    """Top-level work (a film / short drama). Owns shots."""

    __tablename__ = "films"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    cover_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | archived
    # Style preset: camera_params field values copied into every new shot.
    default_camera_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    shots: Mapped[list["Shot"]] = relationship(
        back_populates="film", cascade="all, delete-orphan", passive_deletes=True
    )


class Shot(Base):
    """A single shot inside a film; runs the full extract→prompt→export pipeline."""

    __tablename__ = "shots"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    film_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("films.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    scene_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    is_picked: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | extracted | exported

    source_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    video_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    video_frame_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)

    extract_stride: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extract_max_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extract_frame_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extracted_channels: Mapped[list | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    film: Mapped[Film] = relationship(back_populates="shots")
    camera_params: Mapped["CameraParams | None"] = relationship(
        back_populates="shot", cascade="all, delete-orphan", uselist=False, passive_deletes=True
    )
    background_edits: Mapped[list["BackgroundEdit"]] = relationship(
        back_populates="shot", cascade="all, delete-orphan", passive_deletes=True
    )
    prompts: Mapped[list["PromptRecord"]] = relationship(
        back_populates="shot", cascade="all, delete-orphan", passive_deletes=True
    )
    exports: Mapped[list["ExportRecord"]] = relationship(
        back_populates="shot", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        Index("ix_shots_film_scene", "film_id", "scene_no"),
        Index("ix_shots_film_updated", "film_id", "updated_at"),
    )


class CameraParams(Base):
    """Director-set cinematography choices for one shot (mapping-table option keys)."""

    __tablename__ = "camera_params"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shot_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("shots.id", ondelete="CASCADE"), unique=True
    )

    shot_size: Mapped[str | None] = mapped_column(String(50), nullable=True)
    camera_angle: Mapped[str | None] = mapped_column(String(50), nullable=True)
    focal_length: Mapped[str | None] = mapped_column(String(50), nullable=True)
    aperture: Mapped[str | None] = mapped_column(String(50), nullable=True)
    camera_move: Mapped[str | None] = mapped_column(String(50), nullable=True)
    lighting: Mapped[str | None] = mapped_column(String(50), nullable=True)  # deprecated, split below
    light_position: Mapped[str | None] = mapped_column(String(50), nullable=True)
    light_quality: Mapped[str | None] = mapped_column(String(50), nullable=True)
    light_mood: Mapped[str | None] = mapped_column(String(50), nullable=True)
    time_ambience: Mapped[str | None] = mapped_column(String(50), nullable=True)
    weather: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color_grade: Mapped[str | None] = mapped_column(String(50), nullable=True)
    style_suffix: Mapped[str | None] = mapped_column(String(50), nullable=True)

    subject_desc: Mapped[str] = mapped_column(Text, default="")
    scene_desc: Mapped[str] = mapped_column(Text, default="")
    custom_positive: Mapped[str] = mapped_column(Text, default="")
    custom_negative: Mapped[str] = mapped_column(Text, default="")

    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    shot: Mapped[Shot] = relationship(back_populates="camera_params")


class BackgroundEdit(Base):
    """A user-drawn region on the frame with an edit intent (v1: static box)."""

    __tablename__ = "background_edits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shot_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("shots.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(200))
    edit_type: Mapped[str] = mapped_column(String(20))  # remove | add | replace
    description: Mapped[str] = mapped_column(Text, default="")
    # Normalized 0-1 coordinates relative to the video frame.
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    mask_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    shot: Mapped[Shot] = relationship(back_populates="background_edits")


class PromptRecord(Base):
    """Snapshot of a generated prompt (history preserved per shot)."""

    __tablename__ = "prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shot_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("shots.id", ondelete="CASCADE"), index=True
    )
    positive_prompt: Mapped[str] = mapped_column(Text)
    negative_prompt: Mapped[str] = mapped_column(Text)
    params_snapshot: Mapped[dict] = mapped_column(JSON)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    shot: Mapped[Shot] = relationship(back_populates="prompts")


class ExportRecord(Base):
    __tablename__ = "exports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shot_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("shots.id", ondelete="CASCADE"), index=True
    )
    zip_path: Mapped[str] = mapped_column(String(500))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    manifest: Mapped[dict] = mapped_column(JSON)
    prompt_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    shot: Mapped[Shot] = relationship(back_populates="exports")


class Setting(Base):
    """Global key/value configuration (JSON-encoded values)."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON, nullable=True)


class BoardState(Base):
    """Whiteboard layout per film: card positions, scene frames and the
    connections (edges) drawn between cards — persisted as one JSON blob."""

    __tablename__ = "board_states"

    film_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("films.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class LensState(Base):
    """Per-shot lens control: focus segments (rack focus over the depth map),
    zoom/focal-length segments, and the static focal choice — one JSON blob."""

    __tablename__ = "lens_states"

    shot_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("shots.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class LayoutState(Base):
    """Per-shot layout-channel choices: which blockout groups stay in the
    exported maps (disabled groups render black = no guidance)."""

    __tablename__ = "layout_states"

    shot_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("shots.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
