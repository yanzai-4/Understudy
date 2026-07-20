import numpy as np

from app.extractors.base import ExtractionContext
from app.extractors.canny import CannyExtractor
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


def test_canny_extractor_writes_frames(tmp_path):
    ctx = ExtractionContext(
        shot_dir=tmp_path,
        out_size=(64, 64),
        stride=1,
        effective_fps=24.0,
        total_out_frames=1,
        ort_provider="cpu",
        models_dir=tmp_path,
        app_settings={"canny_low": 100, "canny_high": 200},
        is_cancelled=lambda: False,
    )
    ex = CannyExtractor()
    ex.prepare(ctx)

    frame = np.zeros((64, 64, 3), dtype=np.uint8)
    frame[16:48, 16:48] = 255  # white square -> strong edges
    ex.process_frame(frame, 0, ctx)

    out = tmp_path / "canny" / "frame_000000.png"
    assert out.exists()
    import cv2

    edges = cv2.imdecode(np.fromfile(out, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    assert edges.shape == (64, 64)
    assert edges.max() == 255 and edges[0, 0] == 0

    summary = ex.finalize(ctx)
    assert summary == {"low_threshold": 100, "high_threshold": 200}
