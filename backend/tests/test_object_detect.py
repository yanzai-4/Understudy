"""Foreground detector: letterbox, YOLOX grid decode, NMS, postprocess mapping,
COCO→group asset, and the model-tier wiring. All synthetic — no model file."""
import numpy as np

from app.extractors.layout import OBJECT_GROUPS, load_coco
from app.services import model_manager
from app.services.object_detect import decode_yolox, letterbox, postprocess, _nms


# ---------- preprocessing ----------


def test_letterbox_ratio_and_shape():
    frame = np.zeros((100, 200, 3), np.uint8)  # h=100, w=200
    x, r = letterbox(frame, 64)
    assert x.shape == (1, 3, 64, 64)
    assert abs(r - 0.32) < 1e-6  # min(64/100, 64/200)
    # padding value 114 in the unfilled region (bottom rows)
    assert x[0, 0, 63, 0] == 114.0


# ---------- decode ----------


def test_decode_grid_and_stride():
    size = 64  # strides 8/16/32 → 64 + 16 + 4 = 84 cells
    pred = np.zeros((84, 6), np.float32)  # C = 1
    out = decode_yolox(pred, size)
    # stride-8 cell index 36 = grid (col 4, row 4) → center (32, 32), wh = e^0*8
    assert out[36, 0] == 32 and out[36, 1] == 32
    assert out[36, 2] == 8 and out[36, 3] == 8
    # first stride-16 cell (index 64) → wh = 16; first stride-32 cell → wh = 32
    assert out[64, 2] == 16 and out[80, 2] == 32


# ---------- nms ----------


def test_nms_suppresses_overlap_keeps_separate():
    boxes = np.array([[0, 0, 10, 10], [1, 1, 10, 10], [50, 50, 10, 10]], np.float32)
    scores = np.array([0.9, 0.8, 0.7], np.float32)
    keep = _nms(boxes, scores, 0.45)
    assert 0 in keep and 2 in keep and 1 not in keep  # near-duplicate dropped


# ---------- postprocess ----------


def test_postprocess_one_detection_mapped_to_frame():
    size = 64
    pred = np.zeros((84, 85), np.float32)  # C = 80 (COCO)
    pred[36, 4] = 0.9  # objectness
    pred[36, 5 + 2] = 0.9  # class 2 = car
    dets = postprocess(pred, size, r=1.0, frame_wh=(64, 64), score_thr=0.35, nms_thr=0.45)
    assert len(dets) == 1
    d = dets[0]
    assert d["cls"] == 2
    x, y, w, h = d["box"]
    assert abs((x + w / 2) - 32) <= 2 and abs((y + h / 2) - 32) <= 2  # centered


def test_postprocess_drops_low_scores():
    pred = np.zeros((84, 85), np.float32)
    pred[10, 4] = 0.2  # obj * cls stays below threshold
    pred[10, 5] = 0.2
    assert postprocess(pred, 64, 1.0, (64, 64), 0.35, 0.45) == []


# ---------- COCO asset + grouping ----------


def test_coco_asset_shape_and_groups():
    coco = load_coco()
    assert len(coco["names"]) == 80 and len(coco["groups"]) == 80
    assert coco["names"][2] == "car" and coco["groups"][2] == "vehicle"
    assert coco["groups"][0] == "person"  # people come from the detector too now
    assert coco["groups"][16] == "animal"  # dog → animal group
    assert set(coco["ade_repr"]) >= {"person", "vehicle", "animal", "props"}
    # all subjects come from the detector: person / vehicle / animal / props
    assert OBJECT_GROUPS == {"person", "vehicle", "animal", "props"}
    assert coco["drop"] == []  # nothing dropped — person is a subject here


# ---------- model tier wiring ----------


def test_required_keys_pick_detector_by_tier():
    fast = model_manager.required_keys_for(["layout"], "int8", "fast")
    quality = model_manager.required_keys_for(["layout"], "int8", "quality")
    assert "topformer_ade20k" in fast and "yolox_tiny" in fast  # backdrop + subjects
    assert "yolox_l" in quality and "yolox_tiny" not in quality
    assert model_manager.detector_key_for("quality") == "yolox_l"
    assert model_manager.detector_key_for("fast") == "yolox_tiny"
    # layout defaults to the fast detector when the tier is unspecified
    assert "yolox_tiny" in model_manager.required_keys_for(["layout"], "int8")
