"""Per-frame human segmentation → subject alpha matte (white = person).

Uses U²-Net human-seg (Apache-2.0), a per-frame model that works with stride
sampling (no temporal recurrence). The matte is a control channel in its own
right (feeds VACE-style background replacement: keep inside, regenerate
outside) and lets canny/depth be scoped to the subject at export time.
"""

import cv2
import numpy as np

from app.extractors.base import ExtractionContext, FrameExtractor, register_extractor
from app.extractors.depth import _providers_for
from app.services import model_manager
from app.services.video_io import imwrite_unicode

SEG_SIZE = 320  # U²-Net fixed input
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def subject_alpha(raw: np.ndarray, out_size: tuple[int, int]) -> np.ndarray:
    """Turn the model's raw saliency output into a clean uint8 alpha at out_size.

    `raw` is the network output shaped (1, 1, H, W) or (H, W); min-max
    normalized, resized, then lightly closed + feathered for compositing.
    """
    m = np.asarray(raw, dtype=np.float32)
    while m.ndim > 2:
        m = m[0]
    lo, hi = float(m.min()), float(m.max())
    norm = (m - lo) / (hi - lo) if hi - lo > 1e-6 else np.zeros_like(m)
    alpha = (norm * 255.0).astype(np.uint8)

    w, h = out_size
    alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_LINEAR)
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))  # fill pinholes
    alpha = cv2.GaussianBlur(alpha, (5, 5), 0)  # soft edge for compositing
    return alpha


@register_extractor
class SubjectExtractor(FrameExtractor):
    """Human matte: white where a person is, black elsewhere."""

    name = "subject"
    requires_models = ["u2net_human_seg"]

    def prepare(self, ctx: ExtractionContext) -> None:
        import onnxruntime as ort

        model_file = model_manager.model_path("u2net_human_seg")
        if not model_file.exists():
            raise RuntimeError(
                "Subject segmentation model not downloaded yet — it fetches on first use"
            )
        providers = _providers_for(ctx.ort_provider, ort.get_available_providers())
        self.session = ort.InferenceSession(str(model_file), providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.out = self.output_dir(ctx)
        self.out.mkdir(parents=True, exist_ok=True)

    def _preprocess(self, frame_bgr: np.ndarray) -> np.ndarray:
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        im = cv2.resize(rgb, (SEG_SIZE, SEG_SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
        im = im / max(float(im.max()), 1e-6)  # U²-Net scales by max, not /255
        im = (im - _MEAN) / _STD
        return np.expand_dims(im.transpose(2, 0, 1), axis=0).astype(np.float32)

    def process_frame(self, frame_bgr: np.ndarray, out_index: int, ctx: ExtractionContext) -> None:
        x = self._preprocess(frame_bgr)
        raw = self.session.run(None, {self.input_name: x})[0]  # first output = d1
        alpha = subject_alpha(raw, ctx.out_size)
        imwrite_unicode(self.out / f"frame_{out_index:06d}.png", alpha)

    def finalize(self, ctx: ExtractionContext) -> dict:
        return {"model": "u2net_human_seg"}
