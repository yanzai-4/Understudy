"""Subject matte: alpha normalization, mask intersection, focus-follow, wiring."""
import cv2
import numpy as np

from app.extractors import EXTRACTOR_REGISTRY
from app.extractors.subject import subject_alpha
from app.services import model_manager
from app.services.lens import normalize_lens, resolve_focal_plane, subject_focal_plane
from app.services.masking import mask_channel, subject_binary


# ---------- alpha normalization ----------


def test_subject_alpha_shape_and_range():
    raw = np.zeros((1, 1, 320, 320), np.float32)
    raw[0, 0, 80:240, 80:240] = 5.0  # a bright central blob
    alpha = subject_alpha(raw, out_size=(200, 120))
    assert alpha.shape == (120, 200)  # (h, w) at out_size
    assert alpha.dtype == np.uint8
    assert alpha.max() == 255 and alpha.min() == 0
    assert alpha[60, 100] > 200  # centre is subject
    assert alpha[5, 5] < 60  # corner is background


def test_subject_alpha_flat_output_is_empty():
    raw = np.full((1, 1, 320, 320), 0.3, np.float32)  # no contrast
    alpha = subject_alpha(raw, out_size=(64, 64))
    assert alpha.max() == 0  # nothing salient → fully transparent


# ---------- mask intersection ----------


def test_mask_channel_keeps_subject_zeros_background():
    canny = np.full((100, 100), 255, np.uint8)  # all-white edge frame
    mask = np.zeros((100, 100), np.uint8)
    mask[:, 50:] = 255  # right half is subject
    out = mask_channel(canny, mask)
    assert out[:, :50].max() == 0  # background edges removed
    assert out[:, 50:].min() == 255  # subject edges kept


def test_mask_channel_resizes_mask_and_handles_bgr():
    depth = np.full((60, 80, 3), 200, np.uint8)
    mask = np.zeros((30, 40), np.uint8)  # half-resolution mask
    mask[:, 20:] = 255
    out = mask_channel(depth, mask)
    assert out.shape == (60, 80, 3)
    assert out[:, :40].max() == 0 and out[:, 40:].min() == 200


def test_subject_binary_threshold():
    grad = np.arange(256, dtype=np.uint8).reshape(1, 256)
    b = subject_binary(grad, thresh=0.5)
    assert b[0, 100] == 0 and b[0, 200] == 255


# ---------- wiring ----------


def test_subject_extractor_registered():
    assert "subject" in EXTRACTOR_REGISTRY


def test_subject_requires_seg_model():
    keys = model_manager.required_keys_for(["subject"], "int8")
    assert "u2net_human_seg" in keys
    assert "u2net_human_seg" in model_manager.MANAGED_MODELS


# ---------- focus follows subject ----------


def _write_frame(shot_dir, channel, idx, img):
    d = shot_dir / channel
    d.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(d / f"frame_{idx:06d}.png"), img)


def test_subject_focal_plane_is_median_depth_in_mask(tmp_path):
    depth = np.zeros((40, 40), np.uint8)
    depth[:, :20] = 100  # near-ish left
    depth[:, 20:] = 200  # nearer right
    mask = np.zeros((40, 40), np.uint8)
    mask[:, :20] = 255  # subject is the left half → depth 100
    _write_frame(tmp_path, "depth", 0, depth)
    _write_frame(tmp_path, "subject", 0, mask)

    d0 = subject_focal_plane(tmp_path, 0)
    assert abs(d0 - 100 / 255) < 0.02  # median of the masked region


def test_subject_focal_plane_none_when_no_subject(tmp_path):
    _write_frame(tmp_path, "depth", 0, np.full((40, 40), 128, np.uint8))
    _write_frame(tmp_path, "subject", 0, np.zeros((40, 40), np.uint8))  # empty matte
    assert subject_focal_plane(tmp_path, 0) is None
    assert subject_focal_plane(tmp_path, 5) is None  # missing files


def test_resolve_focal_plane_prefers_subject_then_keyframes(tmp_path):
    depth = np.full((40, 40), 200, np.uint8)
    mask = np.zeros((40, 40), np.uint8)
    mask[10:30, 10:30] = 255
    _write_frame(tmp_path, "depth", 0, depth)
    _write_frame(tmp_path, "subject", 0, mask)

    follow = normalize_lens(
        {"focus": {"enabled": True, "follow_subject": True, "keyframes": [{"frame": 0, "depth": 0.1}]}}
    )
    assert abs(resolve_focal_plane(follow, tmp_path, 0) - 200 / 255) < 0.02  # subject wins

    kf_only = normalize_lens(
        {"focus": {"enabled": True, "follow_subject": False, "keyframes": [{"frame": 0, "depth": 0.1}]}}
    )
    assert abs(resolve_focal_plane(kf_only, tmp_path, 0) - 0.1) < 1e-6  # keyframe used

    # follow on but no subject in frame → fall back to keyframe
    assert abs(resolve_focal_plane(follow, tmp_path, 9) - 0.1) < 1e-6
