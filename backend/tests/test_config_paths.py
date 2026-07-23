import sys
from pathlib import Path

import app.config as cfg
from app.config import Settings, _resource_root, _user_root


def test_dev_mode_roots_collapse_to_repo_root():
    # not frozen → both roots == repo root (backend/app/config.py -> parents[2])
    repo = Path(cfg.__file__).resolve().parents[2]
    assert _resource_root() == repo
    assert _user_root() == repo


def test_dev_paths_unchanged():
    s = Settings(resource_dir=Path("/repo"), user_dir=Path("/repo"))
    assert s.data_dir == Path("/repo/data")
    assert s.models_dir == Path("/repo/models")
    assert s.frontend_dist == Path("/repo/frontend/dist")
    assert s.root_dir == Path("/repo")


def test_frozen_splits_resource_and_user():
    s = Settings(resource_dir=Path("/bundle"), user_dir=Path("/userdata"))
    # writable under user_dir
    assert s.data_dir == Path("/userdata/data")
    assert s.films_dir == Path("/userdata/data/films")
    assert s.models_dir == Path("/userdata/models")
    assert s.db_path == Path("/userdata/data/understudy.db")
    # read-only under resource_dir
    assert s.frontend_dist == Path("/bundle/frontend/dist")
    assert s.bundled_models_dir == Path("/bundle/models")
    assert s.root_dir == Path("/bundle")


def test_user_root_frozen_uses_appdata(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", r"C:\Users\x\AppData\Local")
    assert _user_root() == Path(r"C:\Users\x\AppData\Local") / "Understudy"
