"""Filesystem layout for film/shot assets and their /files URLs.

data/films/<film_id>/shots/<shot_id>/{source,thumbnail,frames,pose,depth,canny,masks,exports}/
The /files static mount points at data/films, so URLs mirror the same layout.
"""

import shutil
from pathlib import Path

from app.config import settings

SHOT_SUBDIRS = ["source", "thumbnail", "frames", "pose", "depth", "masks", "exports"]


def film_dir(film_id: str) -> Path:
    return settings.films_dir / film_id


def shot_dir(film_id: str, shot_id: str) -> Path:
    return film_dir(film_id) / "shots" / shot_id


def ensure_shot_dirs(film_id: str, shot_id: str) -> Path:
    base = shot_dir(film_id, shot_id)
    for sub in SHOT_SUBDIRS:
        (base / sub).mkdir(parents=True, exist_ok=True)
    return base


def delete_film_dir(film_id: str) -> None:
    shutil.rmtree(film_dir(film_id), ignore_errors=True)


def reset_films_dir() -> None:
    """Remove every film's files and recreate an empty films directory."""
    shutil.rmtree(settings.films_dir, ignore_errors=True)
    settings.films_dir.mkdir(parents=True, exist_ok=True)


def delete_shot_dir(film_id: str, shot_id: str) -> None:
    shutil.rmtree(shot_dir(film_id, shot_id), ignore_errors=True)


def thumbnail_path(film_id: str, shot_id: str) -> Path:
    return shot_dir(film_id, shot_id) / "thumbnail" / "thumb.jpg"


def file_url(film_id: str, shot_id: str, *parts: str) -> str:
    return "/files/" + "/".join([film_id, "shots", shot_id, *parts])


def thumbnail_url(film_id: str, shot_id: str) -> str | None:
    if thumbnail_path(film_id, shot_id).exists():
        return file_url(film_id, shot_id, "thumbnail", "thumb.jpg")
    return None
