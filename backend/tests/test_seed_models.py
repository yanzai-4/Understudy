from pathlib import Path

import app.config as cfg
from app.services import model_manager


def test_seed_copies_missing_and_is_idempotent(tmp_path, monkeypatch):
    bundle = tmp_path / "bundle" / "models"
    userm = tmp_path / "user" / "models"
    # one bundled model file laid out by its relpath
    key = "topformer_ade20k"
    rel = model_manager.MANAGED_MODELS[key]["relpath"]
    (bundle / Path(rel).parent).mkdir(parents=True)
    (bundle / rel).write_bytes(b"fake-onnx")

    monkeypatch.setattr(cfg.settings, "resource_dir", tmp_path / "bundle", raising=False)
    monkeypatch.setattr(cfg.settings, "user_dir", tmp_path / "user", raising=False)

    seeded = model_manager.seed_bundled_models()
    assert key in seeded
    assert (userm / rel).read_bytes() == b"fake-onnx"

    # second call copies nothing
    assert model_manager.seed_bundled_models() == []
