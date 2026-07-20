import numpy as np

from app.services.mask_renderer import _render


def test_render_geometry():
    mask = _render(200, 100, x=0.25, y=0.5, w=0.5, h=0.25)
    assert mask.shape == (100, 200)
    assert mask.dtype == np.uint8
    # inside the box
    assert mask[60, 100] == 255
    # outside: above, left, right, below
    assert mask[40, 100] == 0
    assert mask[60, 40] == 0
    assert mask[60, 160] == 0
    assert mask[90, 100] == 0


def test_render_full_frame():
    mask = _render(64, 64, 0.0, 0.0, 1.0, 1.0)
    assert mask.min() == 255


def test_render_clamps_out_of_range():
    mask = _render(100, 100, 0.9, 0.9, 0.5, 0.5)
    assert mask[95, 95] == 255
    assert mask.shape == (100, 100)


def test_render_zero_area_box():
    mask = _render(100, 100, 0.5, 0.5, 0.0, 0.0)
    assert mask.max() == 0
