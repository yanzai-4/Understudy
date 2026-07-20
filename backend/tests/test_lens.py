import numpy as np

from app.services.lens import (
    apply_zoom,
    crop_window,
    focal_mm,
    interp_keyframes,
    lens_phrases,
    normalize_lens,
    render_dof,
    transform_points,
    zoom_params_at,
)
from app.services.prompt_builder import load_mappings


# ---------- interpolation ----------


def test_interp_flat_extrapolation_and_midpoint():
    kfs = [{"frame": 10, "depth": 0.2}, {"frame": 20, "depth": 0.8}]
    assert interp_keyframes(kfs, 0, "depth") == 0.2
    assert interp_keyframes(kfs, 30, "depth") == 0.8
    assert abs(interp_keyframes(kfs, 15, "depth", "linear") - 0.5) < 1e-6


def test_interp_smooth_easing_midpoint_matches_linear():
    kfs = [{"frame": 0, "depth": 0.0}, {"frame": 10, "depth": 1.0}]
    # smoothstep(0.5) == 0.5 but slope differs at edges
    assert abs(interp_keyframes(kfs, 5, "depth", "smooth") - 0.5) < 1e-6
    assert interp_keyframes(kfs, 2, "depth", "smooth") < 0.2  # slow start


def test_interp_single_keyframe():
    kfs = [{"frame": 5, "depth": 0.7}]
    assert interp_keyframes(kfs, 0, "depth") == 0.7
    assert interp_keyframes(kfs, 99, "depth") == 0.7


# ---------- dof ----------


def test_render_dof_sharp_at_focal_plane_blurred_away():
    frame = np.zeros((64, 64, 3), np.uint8)
    frame[:, ::2] = 255  # high-frequency stripes so blur is measurable
    depth = np.zeros((64, 64), np.uint8)
    depth[:, :32] = 255  # left half near, right half far

    dof, fmap = render_dof(frame, depth, d0=1.0, max_blur=8, falloff=0.5)
    # focal plane at near (left): stays sharp, map white
    assert fmap[32, 10] == 255
    assert np.array_equal(dof[:, :30], frame[:, :30])
    # far side: blurred, map black
    assert fmap[32, 50] == 0
    assert not np.array_equal(dof[:, 34:], frame[:, 34:])


# ---------- zoom ----------


def test_focal_mm_parsing():
    assert focal_mm("35mm") == 35
    assert focal_mm("135mm") == 135
    assert focal_mm(None) is None


def test_zoom_scale_relative_to_widest_keyframe():
    lens = normalize_lens(
        {
            "zoom": {
                "enabled": True,
                "keyframes": [
                    {"frame": 0, "focal": "35mm", "cx": 0.5, "cy": 0.5},
                    {"frame": 10, "focal": "70mm", "cx": 0.5, "cy": 0.5},
                ],
            }
        }
    )
    s0, _, _ = zoom_params_at(lens, 0)
    s1, _, _ = zoom_params_at(lens, 10)
    assert abs(s0 - 1.0) < 1e-6
    assert abs(s1 - 2.0) < 1e-6


def test_crop_window_clamped():
    x, y, cw, ch = crop_window(100, 100, scale=2.0, cx=0.95, cy=0.05)
    assert x + cw <= 100 and y >= 0


def test_apply_zoom_keeps_size_and_transform_points_roundtrip():
    img = np.zeros((100, 200, 3), np.uint8)
    out = apply_zoom(img, 2.0, 0.5, 0.5)
    assert out.shape == img.shape
    pts = np.array([[100.0, 50.0]])  # center stays center at cx=cy=0.5
    moved = transform_points(pts, 200, 100, 2.0, 0.5, 0.5)
    assert abs(moved[0, 0] - 100) < 2 and abs(moved[0, 1] - 50) < 2


# ---------- phrases (must mirror frontend lensPhrase.ts) ----------


def _mappings():
    return load_mappings()


def test_phrase_single_focus_with_label():
    lens = {"focus": {"enabled": True, "keyframes": [{"frame": 0, "depth": 0.8, "label": "the woman"}]}}
    assert lens_phrases(lens, _mappings(), False) == ["sharp focus on the woman"]


def test_phrase_rack_focus_fallback_labels():
    lens = {
        "focus": {
            "enabled": True,
            "keyframes": [{"frame": 0, "depth": 0.1}, {"frame": 30, "depth": 0.9}],
        }
    }
    assert lens_phrases(lens, _mappings(), False) == [
        "rack focus from the distant background to the foreground subject"
    ]


def test_phrase_static_focal():
    lens = {"focal": "85mm"}
    phrases = lens_phrases(lens, _mappings(), False)
    assert phrases == ["shot on 85mm portrait lens, compressed background"]


def test_phrase_zoom_and_camera_move_precedence():
    zoom_kfs = [{"frame": 0, "focal": "35mm"}, {"frame": 20, "focal": "85mm"}]
    lens = {"zoom": {"enabled": True, "keyframes": zoom_kfs}}
    assert lens_phrases(lens, _mappings(), False) == ["smooth zoom from 35mm to 85mm"]
    # explicit camera_move wins over the auto zoom phrase
    assert lens_phrases(lens, _mappings(), True) == []
