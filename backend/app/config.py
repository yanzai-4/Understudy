import os
import sys
from pathlib import Path

from pydantic_settings import BaseSettings


def _is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def _resource_root() -> Path:
    """Read-only root: the PyInstaller bundle when frozen, else the repo root."""
    if _is_frozen():
        meipass = getattr(sys, "_MEIPASS", None)
        return Path(meipass) if meipass else Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def _user_root() -> Path:
    """Writable root: an OS user-data dir when frozen, else the repo root."""
    if not _is_frozen():
        return Path(__file__).resolve().parents[2]
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    return base / "Understudy"


class Settings(BaseSettings):
    """Static app configuration. User-tunable options live in the settings DB table."""

    resource_dir: Path = _resource_root()  # read-only bundled files
    user_dir: Path = _user_root()  # writable data + models

    host: str = "127.0.0.1"
    port: int = 8000

    max_upload_bytes: int = 2 * 1024 * 1024 * 1024  # 2 GB
    default_page_size: int = 24
    max_page_size: int = 100

    # Extraction defaults (overridable per request / via settings table)
    default_max_size: int = 768
    auto_stride_target_frames: int = 300

    # Back-compat: source-tree scripts (provider switch) resolve from here. In a
    # frozen app this points at the read-only bundle, so those scripts aren't
    # found and api/system.py falls back to its manual-guidance message.
    @property
    def root_dir(self) -> Path:
        return self.resource_dir

    @property
    def data_dir(self) -> Path:
        return self.user_dir / "data"

    @property
    def films_dir(self) -> Path:
        return self.data_dir / "films"

    @property
    def models_dir(self) -> Path:
        return self.user_dir / "models"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "understudy.db"

    @property
    def frontend_dist(self) -> Path:
        return self.resource_dir / "frontend" / "dist"

    @property
    def bundled_models_dir(self) -> Path:
        return self.resource_dir / "models"

    @property
    def user_mappings_path(self) -> Path:
        return self.data_dir / "prompt_mappings.json"

    @property
    def builtin_mappings_path(self) -> Path:
        bundled = self.resource_dir / "backend" / "app" / "assets" / "prompt_mappings.json"
        return bundled if bundled.exists() else Path(__file__).resolve().parent / "assets" / "prompt_mappings.json"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.films_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
