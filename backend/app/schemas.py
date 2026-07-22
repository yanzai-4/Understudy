from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")

ShotStatus = Literal["draft", "extracted", "exported"]


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


# ---------- Films ----------


class FilmCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class FilmUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    notes: str | None = None
    status: Literal["active", "archived"] | None = None
    default_camera_params: dict | None = None


class FilmOut(BaseModel):
    id: str
    name: str
    description: str
    notes: str
    status: str
    cover_url: str | None = None
    default_camera_params: dict | None = None
    shot_count: int = 0
    scene_count: int = 0
    exported_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- Shots ----------


class ShotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scene_no: int | None = Field(default=None, ge=0)
    tags: list[str] = []
    notes: str = ""


class ShotUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    scene_no: int | None = Field(default=None, ge=0)
    clear_scene_no: bool = False
    version: int | None = Field(default=None, ge=1)
    tags: list[str] | None = None
    notes: str | None = None
    is_picked: bool | None = None


class ShotOut(BaseModel):
    id: str
    film_id: str
    name: str
    scene_no: int | None
    version: int
    tags: list[str]
    is_picked: bool
    notes: str
    status: ShotStatus
    thumbnail_url: str | None = None
    source_filename: str | None
    video_width: int | None
    video_height: int | None
    video_fps: float | None
    video_frame_count: int | None
    video_duration_sec: float | None
    extract_stride: int | None
    extract_max_size: int | None
    extract_frame_count: int | None
    extracted_channels: list[str] | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SceneGroup(BaseModel):
    scene_no: int | None
    shots: list[ShotOut]


class ShotGroups(BaseModel):
    groups: list[SceneGroup]
    total: int


class ShotDuplicate(BaseModel):
    as_new_version: bool = True


# ---------- Settings ----------


class SettingsUpdate(BaseModel):
    values: dict
