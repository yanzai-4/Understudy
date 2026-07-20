"""Guard the bundled demo manifest: every shot must map to a real pre-extracted
asset, strings must be bilingual, camera keys must be valid, and the scene
layout must match what the UI showcases (scene 1 of the city short = 2 takes)."""
from app.models import CameraParams
from app.services.demos import CAMERA_COLS, DEMO_FILMS, demos_available, ASSETS


def test_bundled_assets_present_for_every_shot():
    assert demos_available(), f"no bundled demo assets under {ASSETS}"
    for film in DEMO_FILMS:
        for shot in film["shots"]:
            asset = ASSETS / shot["asset"]
            assert asset.is_dir(), f"missing demo asset dir: {asset}"
            assert (asset / "extraction.json").exists(), f"missing extraction.json in {asset}"
            assert (asset / "frames").is_dir() and any((asset / "frames").glob("*.jpg"))


def test_strings_are_bilingual():
    for film in DEMO_FILMS:
        for key in ("name", "description"):
            assert set(film[key]) >= {"zh", "en"}, f"{key} not bilingual"
        for shot in film["shots"]:
            for key in ("name", "tags", "subject", "scene"):
                assert set(shot[key]) >= {"zh", "en"}, f"shot {key} not bilingual"


def test_camera_keys_are_real_columns():
    valid = set(CameraParams.__table__.columns.keys())
    for col in CAMERA_COLS:
        assert col in valid, f"CAMERA_COLS has unknown column: {col}"
    for film in DEMO_FILMS:
        for shot in film["shots"]:
            for col in shot["camera"]:
                assert col in CAMERA_COLS, f"shot camera uses unmapped key: {col}"


def test_city_short_scene_one_has_two_takes():
    city = next(f for f in DEMO_FILMS if f["name"]["en"] == "Demo · City Short")
    scene_counts: dict[int, int] = {}
    for shot in city["shots"]:
        scene_counts[shot["scene_no"]] = scene_counts.get(shot["scene_no"], 0) + 1
    assert scene_counts[1] == 2, "scene 1 should contain two shots (corridor V1 + V2)"
    assert sorted(scene_counts) == [1, 2, 3], "city short should span scenes 1-3"
