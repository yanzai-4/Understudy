import numpy as np

from app.services.pipeline import compute_stride
from app.services.video_io import resize_long_edge


def test_compute_stride_auto_caps_at_target():
    assert compute_stride(300, "auto") == 1
    assert compute_stride(301, "auto") == 2
    assert compute_stride(900, "auto") == 3
    assert compute_stride(10, "auto") == 1


def test_compute_stride_explicit():
    assert compute_stride(1000, 4) == 4
    assert compute_stride(1000, 1) == 1


def test_resize_long_edge_caps_and_evens():
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    out = resize_long_edge(frame, 768)
    h, w = out.shape[:2]
    assert w == 768 and h % 2 == 0 and h <= 768


def test_resize_long_edge_never_upscales():
    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    out = resize_long_edge(frame, 768)
    assert out.shape[:2] == (360, 640)


