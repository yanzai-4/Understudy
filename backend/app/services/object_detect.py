"""Foreground object detection for the layout channel.

A semantic-segmentation map can't tell two objects apart or keep one object
whole when something occludes it (a person in front of a car splits the car's
pixels into two blobs → two "cars"). A detector returns one box per object and
labels it, which is exactly what the blockout needs for the movable foreground
(vehicles, props). Backdrop/structure stays on segmentation; people stay on pose.

Default model is YOLOX (Apache-2.0); the pre/post-processing here is the
standard YOLOX pipeline (letterbox pad 114, grid-stride decode, per-class NMS).
The class is model-file agnostic — a bigger YOLOX (quality tier) or another
YOLOX-family export drops in without code changes.
"""

import cv2
import numpy as np

STRIDES = (8, 16, 32)  # YOLOX FPN strides (no P6 for tiny/s/m/l/x)


def letterbox(frame_bgr: np.ndarray, size: int) -> tuple[np.ndarray, float]:
    """Resize keeping aspect into a size×size canvas padded with 114.
    Returns the CHW float32 tensor input and the resize ratio r."""
    h, w = frame_bgr.shape[:2]
    r = min(size / h, size / w)
    nh, nw = int(round(h * r)), int(round(w * r))
    resized = cv2.resize(frame_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), 114.0, dtype=np.float32)
    canvas[:nh, :nw] = resized
    chw = np.ascontiguousarray(canvas.transpose(2, 0, 1)[None], dtype=np.float32)
    return chw, r


def decode_yolox(pred: np.ndarray, size: int) -> np.ndarray:
    """Grid-stride decode of raw YOLOX output (N, 5+C) → same array with the
    box columns turned into absolute [cx, cy, w, h] in input pixels."""
    grids, strides = [], []
    for s in STRIDES:
        g = size // s
        xv, yv = np.meshgrid(np.arange(g), np.arange(g))
        grid = np.stack((xv, yv), 2).reshape(-1, 2)
        grids.append(grid)
        strides.append(np.full((grid.shape[0], 1), s, dtype=np.float32))
    grid = np.concatenate(grids, 0).astype(np.float32)
    stride = np.concatenate(strides, 0)
    out = pred.copy()
    out[:, :2] = (pred[:, :2] + grid) * stride
    out[:, 2:4] = np.exp(pred[:, 2:4]) * stride
    return out


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thr: float) -> list[int]:
    """Plain greedy NMS on [x, y, w, h] boxes. Returns kept indices."""
    if len(boxes) == 0:
        return []
    x1, y1 = boxes[:, 0], boxes[:, 1]
    x2, y2 = boxes[:, 0] + boxes[:, 2], boxes[:, 1] + boxes[:, 3]
    areas = boxes[:, 2] * boxes[:, 3]
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-9)
        order = order[1:][iou <= iou_thr]
    return keep


def postprocess(
    raw: np.ndarray, size: int, r: float, frame_wh: tuple[int, int],
    score_thr: float, nms_thr: float,
) -> list[dict]:
    """Raw YOLOX output (N, 5+C) → detections in original-frame pixel coords."""
    decoded = decode_yolox(raw, size)
    scores_all = decoded[:, 4:5] * decoded[:, 5:]  # obj * class
    cls = scores_all.argmax(1)
    score = scores_all[np.arange(len(cls)), cls]
    m = score >= score_thr
    if not m.any():
        return []
    cx, cy, bw, bh = decoded[m, 0], decoded[m, 1], decoded[m, 2], decoded[m, 3]
    boxes = np.stack([cx - bw / 2, cy - bh / 2, bw, bh], 1) / r  # letterbox → source
    cls, score = cls[m], score[m]
    w, h = frame_wh
    out: list[dict] = []
    for c in np.unique(cls):  # per-class NMS
        idx = np.where(cls == c)[0]
        for k in _nms(boxes[idx], score[idx], nms_thr):
            x, y, bw_, bh_ = boxes[idx][k]
            x0, y0 = max(0.0, float(x)), max(0.0, float(y))
            x1, y1 = min(float(w), x + bw_), min(float(h), y + bh_)
            if x1 - x0 < 1 or y1 - y0 < 1:
                continue
            out.append(
                {"box": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
                 "cls": int(c), "score": round(float(score[idx][k]), 3)}
            )
    return out


class ObjectDetector:
    """YOLOX-family ONNX detector. Input size is read from the model."""

    def __init__(self, model_path, providers, score_thr: float = 0.35, nms_thr: float = 0.45):
        import onnxruntime as ort

        self.session = ort.InferenceSession(str(model_path), providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        shape = self.session.get_inputs()[0].shape  # [1, 3, H, W]
        dim = shape[2] if isinstance(shape[2], int) else None
        self.size = int(dim) if dim else 416
        self.score_thr = score_thr
        self.nms_thr = nms_thr

    def detect(self, frame_bgr: np.ndarray) -> list[dict]:
        x, r = letterbox(frame_bgr, self.size)
        raw = self.session.run(None, {self.input_name: x})[0][0]  # (N, 5+C)
        h, w = frame_bgr.shape[:2]
        return postprocess(raw, self.size, r, (w, h), self.score_thr, self.nms_thr)
