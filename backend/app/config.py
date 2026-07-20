from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Static app configuration. User-tunable options live in the settings DB table."""

    # Repo root = parents[2] (backend/app/config.py -> Understudy/)
    root_dir: Path = Path(__file__).resolve().parents[2]

    host: str = "127.0.0.1"
    port: int = 8000

    max_upload_bytes: int = 2 * 1024 * 1024 * 1024  # 2 GB
    default_page_size: int = 24
    max_page_size: int = 100

    # Extraction defaults (overridable per request / via settings table)
    default_max_size: int = 768
    auto_stride_target_frames: int = 300

    @property
    def data_dir(self) -> Path:
        return self.root_dir / "data"

    @property
    def films_dir(self) -> Path:
        return self.data_dir / "films"

    @property
    def models_dir(self) -> Path:
        return self.root_dir / "models"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "understudy.db"

    @property
    def frontend_dist(self) -> Path:
        return self.root_dir / "frontend" / "dist"

    @property
    def user_mappings_path(self) -> Path:
        return self.data_dir / "prompt_mappings.json"

    @property
    def builtin_mappings_path(self) -> Path:
        return Path(__file__).resolve().parent / "assets" / "prompt_mappings.json"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.films_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
