"""Layout channel: ADE asset integrity, colorization, grouping,
group-disable blackout, and wiring."""
import numpy as np

from app.extractors import EXTRACTOR_REGISTRY
from app.extractors.layout import (
    ade_lut,
    blockout_lut,
    colorize_ids,
    load_ade20k,
    shade_by_depth,
)
from app.services import model_manager

META = load_ade20k()


# ---------- asset integrity ----------


def test_asset_has_150_everything():
    assert len(META["classes"]) == 150
    assert len(META["palette"]) == 150
    assert len(META["groups"]) == 150
    assert META["classes"][META["person_index"]] == "person"


def test_every_group_is_known_and_colored():
    for group in META["groups"]:
        assert group in META["blockout_palette"], group
    assert set(META["group_order"]) == set(META["blockout_palette"])


# ---------- colorization ----------


def test_colorize_ids_uses_official_palette_bgr():
    ids = np.array([[0, 2], [12, 20]], np.uint8)  # wall, sky, person, car
    out = colorize_ids(ids, ade_lut(META))
    # palette is RGB; output is BGR
    assert out[0, 0].tolist() == META["palette"][0][::-1]
    assert out[1, 0].tolist() == META["palette"][12][::-1]


def test_blockout_disabled_group_is_black():
    ids = np.array([[META["person_index"], META["classes"].index("car")]], np.uint8)
    lut = blockout_lut(META, disabled={"vehicle"})
    out = colorize_ids(ids, lut)
    assert out[0, 0].tolist() == META["blockout_palette"]["person"][::-1]
    assert out[0, 1].tolist() == [0, 0, 0]  # vehicle dropped → no guidance


def test_shade_by_depth_near_brighter_than_far():
    color = np.full((2, 2, 3), 200, np.uint8)
    depth = np.array([[255, 0], [255, 0]], np.uint8)  # left near, right far
    out = shade_by_depth(color, depth)
    assert out[0, 0, 0] > out[0, 1, 0]
    assert out[0, 0, 0] == 200  # near keeps full brightness
    assert abs(int(out[0, 1, 0]) - int(200 * 0.55)) <= 1


# ---------- wiring ----------


def test_layout_registered_and_requires_models():
    assert "layout" in EXTRACTOR_REGISTRY
    keys = model_manager.required_keys_for(["layout"], "int8")
    assert "topformer_ade20k" in keys  # backdrop
    assert "yolox_tiny" in keys  # subjects
