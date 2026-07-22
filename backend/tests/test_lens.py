import json

import cv2
import numpy as np

from app.services.lens import (
    SEGMENT_CAP,
    apply_zoom,
    crop_window,
    focal_mm,
    focal_plane_at,
    focus_is_active,
    lens_phrases,
    normalize_lens,
    render_dof,
    resolve_focal_plane,
    segment_value_at,
    subject_focal_plane,
    transform_points,
    zoom_params_at,
)
from app.services.prompt_builder import load_mappings


# ---------- segment interpolation ----------


def test_segment_hold_then_gap_ease():
    # seg A holds 0.2 over [0,10]; gap 10..20; seg B holds 0.8 over [20,30]
    segs = [{"start": 0, "end": 10, "depth": 0.2}, {"start": 20, "end": 30, "depth": 0.8}]
    assert segment_value_at(segs, 5, "depth") == 0.2  # inside A → held
    assert segment_value_at(segs, 25, "depth") == 0.8  # inside B → held
    assert abs(segment_value_at(segs, 15, "depth", "linear") - 0.5) < 1e-6  # gap midpoint


def test_segment_flat_extrapolation():
    segs = [{"start": 10, "end": 20, "depth": 0.3}]
    assert segment_value_at(segs, 0, "depth") == 0.3  # before first
    assert segment_value_at(segs, 99, "depth") == 0.3  # after last


def test_segment_touching_is_single_switch():
    # adjacent segments (end == start): value switches at the shared frame
    segs = [{"start": 0, "end": 15, "depth": 0.2}, {"start": 15, "end": 30, "depth": 0.9}]
    assert segment_value_at(segs, 15, "depth") == 0.2  # 交汇点 still holds A
    assert segment_value_at(segs, 16, "depth") == 0.9  # next frame is B → hard switch


def test_segment_smooth_easing_slow_start():
    segs = [{"start": 0, "end": 0, "depth": 0.0}, {"start": 10, "end": 10, "depth": 1.0}]
    assert abs(segment_value_at(segs, 5, "depth", "smooth") - 0.5) < 1e-6
    assert segment_value_at(segs, 2, "depth", "smooth") < 0.2  # eased slow start


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


def test_zoom_scale_relative_to_widest_segment():
    lens = normalize_lens(
        {
            "zoom": {
                "enabled": True,
                "segments": [
                    {"start": 0, "end": 0, "focal": "35mm", "cx": 0.5, "cy": 0.5},
                    {"start": 10, "end": 10, "focal": "70mm", "cx": 0.5, "cy": 0.5},
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
    lens = {"focus": {"enabled": True, "segments": [{"start": 0, "end": 10, "depth": 0.8, "label": "the woman"}]}}
    assert lens_phrases(lens, _mappings(), False) == ["sharp focus on the woman"]


def test_phrase_rack_focus_fallback_labels():
    lens = {
        "focus": {
            "enabled": True,
            "segments": [
                {"start": 0, "end": 10, "depth": 0.1},
                {"start": 30, "end": 40, "depth": 0.9},
            ],
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
    zoom_segs = [
        {"start": 0, "end": 10, "focal": "35mm"},
        {"start": 20, "end": 30, "focal": "85mm"},
    ]
    lens = {"zoom": {"enabled": True, "segments": zoom_segs}}
    assert lens_phrases(lens, _mappings(), False) == ["smooth zoom from 35mm to 85mm"]
    # explicit camera_move wins over the auto zoom phrase
    assert lens_phrases(lens, _mappings(), True) == []


# ---------- normalization: caps, overlap, legacy migration ----------


def test_normalize_caps_segments_per_lane():
    segs = [{"start": i * 10, "end": i * 10 + 5, "depth": 0.5} for i in range(6)]
    lens = normalize_lens({"focus": {"enabled": True, "segments": segs}})
    assert len(lens["focus"]["segments"]) == SEGMENT_CAP  # capped at 3


def test_normalize_deoverlaps_and_sorts():
    segs = [
        {"start": 30, "end": 50, "depth": 0.9},  # out of order
        {"start": 0, "end": 40, "depth": 0.1},  # overlaps the first
    ]
    lens = normalize_lens({"focus": {"enabled": True, "segments": segs}})
    out = lens["focus"]["segments"]
    assert [s["start"] for s in out] == sorted(s["start"] for s in out)  # sorted
    assert out[1]["start"] >= out[0]["end"]  # no overlap (start clipped up)


def test_normalize_migrates_legacy_keyframes():
    lens = normalize_lens(
        {"focus": {"enabled": True, "keyframes": [{"frame": 5, "depth": 0.7, "label": "x"}]}}
    )
    segs = lens["focus"]["segments"]
    assert len(segs) == 1 and segs[0]["start"] == 5 and segs[0]["end"] == 5
    assert segs[0]["depth"] == 0.7 and segs[0]["label"] == "x"
    assert "keyframes" not in lens["focus"]


def test_focus_is_active_needs_segments_or_follow():
    assert not focus_is_active(normalize_lens({"focus": {"enabled": True}})["focus"])
    assert focus_is_active(
        normalize_lens({"focus": {"enabled": True, "follow_subject": True}})["focus"]
    )
    assert focus_is_active(
        normalize_lens(
            {"focus": {"enabled": True, "segments": [{"start": 0, "end": 5, "depth": 0.5}]}}
        )["focus"]
    )


# ---------- focus follows the performer (from pose) ----------


def _write_depth(shot_dir, idx, img):
    d = shot_dir / "depth"
    d.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(d / f"frame_{idx:06d}.png"), img)


def _write_pose(shot_dir, frames):
    d = shot_dir / "pose"
    d.mkdir(parents=True, exist_ok=True)
    (d / "keypoints.json").write_text(json.dumps({"frames": frames}), encoding="utf-8")


def _person(pts):
    return {"keypoints": pts, "scores": [1.0] * len(pts)}


def test_subject_focal_plane_is_median_depth_at_keypoints(tmp_path):
    depth = np.zeros((40, 40), np.uint8)
    depth[:, :20] = 100  # left region
    depth[:, 20:] = 200  # right region
    _write_depth(tmp_path, 0, depth)
    # three keypoints all in the left region → median depth 100
    _write_pose(tmp_path, [{"frame": 0, "people": [_person([[5, 5], [5, 20], [10, 30]])]}])

    d0 = subject_focal_plane(tmp_path, 0)
    assert abs(d0 - 100 / 255) < 0.02


def test_subject_focal_plane_none_when_no_pose(tmp_path):
    _write_depth(tmp_path, 0, np.full((40, 40), 128, np.uint8))
    _write_pose(tmp_path, [{"frame": 0, "people": []}])  # nobody detected
    assert subject_focal_plane(tmp_path, 0) is None
    assert subject_focal_plane(tmp_path, 5) is None  # missing files


def test_subject_focal_plane_skips_low_score_keypoints(tmp_path):
    _write_depth(tmp_path, 0, np.full((40, 40), 200, np.uint8))
    person = {"keypoints": [[5, 5], [6, 6], [7, 7]], "scores": [0.1, 0.1, 0.1]}
    _write_pose(tmp_path, [{"frame": 0, "people": [person]}])
    assert subject_focal_plane(tmp_path, 0) is None  # all below threshold → too few


def test_resolve_focal_plane_prefers_pose_then_segments(tmp_path):
    _write_depth(tmp_path, 0, np.full((40, 40), 200, np.uint8))
    _write_pose(tmp_path, [{"frame": 0, "people": [_person([[10, 10], [20, 20], [30, 30]])]}])

    follow = normalize_lens(
        {"focus": {"enabled": True, "follow_subject": True, "segments": [{"start": 0, "end": 20, "depth": 0.1}]}}
    )
    assert abs(resolve_focal_plane(follow, tmp_path, 0) - 200 / 255) < 0.02  # pose wins

    seg_only = normalize_lens(
        {"focus": {"enabled": True, "follow_subject": False, "segments": [{"start": 0, "end": 20, "depth": 0.1}]}}
    )
    assert abs(resolve_focal_plane(seg_only, tmp_path, 0) - 0.1) < 1e-6  # segment value

    # follow on but nobody at this frame (still within span) → fall back to the segment
    assert abs(resolve_focal_plane(follow, tmp_path, 9) - 0.1) < 1e-6


def test_focus_and_zoom_confined_to_span():
    focus = normalize_lens({"focus": {"enabled": True, "segments": [{"start": 10, "end": 20, "depth": 0.7}]}})
    assert focal_plane_at(focus, 5) is None  # before span → sharp
    assert focal_plane_at(focus, 25) is None  # after span → sharp
    assert focal_plane_at(focus, 15) == 0.7  # inside → held

    zoom = normalize_lens(
        {
            "zoom": {
                "enabled": True,
                "segments": [
                    {"start": 10, "end": 20, "focal": "35mm", "cx": 0.5, "cy": 0.5},
                    {"start": 30, "end": 40, "focal": "70mm", "cx": 0.5, "cy": 0.5},
                ],
            }
        }
    )
    assert zoom_params_at(zoom, 5) is None  # before span
    assert zoom_params_at(zoom, 45) is None  # after span
    assert zoom_params_at(zoom, 15) is not None  # inside
