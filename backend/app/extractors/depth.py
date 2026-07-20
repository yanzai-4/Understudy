import math

import cv2
import numpy as np

from app.extractors.base import ExtractionContext, FrameExtractor, register_extractor
from app.services import model_manager
from app.services.video_io import imwrite_unicode

TARGET = 518  # Depth Anything V2 lower-bound resize target
MULTIPLE = 14
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Map the user's inference-backend choice to an onnxruntime execution-provider
# list, honouring what the installed onnxruntime build actually offers. GPU
# providers always keep CPU as a fallback. DirectML ships on Windows;
# CoreML ships in the stock macOS onnxruntime wheel.
_PROVIDER_EP = {
    "directml": "DmlExecutionProvider",
    "coreml": "CoreMLExecutionProvider",
}


def _providers_for(ort_provider: str, available: list[str]) -> list[str]:
    ep = _PROVIDER_EP.get(ort_provider)
    if ep and ep in available:
        return [ep, "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


@register_extractor
class DepthExtractor(FrameExtractor):
    """Relative depth maps (white = near), Depth Anything V2 small ONNX."""

    name = "depth"
    requires_models = ["depth_anything_v2_int8"]

    def prepare(self, ctx: ExtractionContext) -> None:
        import onnxruntime as ort

        variant = str(ctx.app_settings.get("depth_model_variant", "int8"))
        model_file = model_manager.depth_model_path(variant)
        if not model_file.exists():
            # Fall back to whichever variant is present before failing.
            other = model_manager.depth_model_path("fp32" if variant == "int8" else "int8")
            if other.exists():
                model_file = other
            else:
                raise RuntimeError(
                    "Depth model not downloaded yet — fetch it from Settings → Models"
                )

        providers = _providers_for(ctx.ort_provider, ort.get_available_providers())
        self.session = ort.InferenceSession(str(model_file), providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.model_label = f"depth-anything-v2-small ({model_file.stem})"
        self.out = self.output_dir(ctx)
        self.out.mkdir(parents=True, exist_ok=True)

    def _preprocess(self, frame_bgr: np.ndarray) -> np.ndarray:
        h, w = frame_bgr.shape[:2]
        # lower_bound resize: both edges >= TARGET, rounded up to a multiple of 14.
        scale = TARGET / min(h, w)
        nh = math.ceil(h * scale / MULTIPLE) * MULTIPLE
        nw = math.ceil(w * scale / MULTIPLE) * MULTIPLE
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_CUBIC)
        x = resized.astype(np.float32) / 255.0
        x = (x - IMAGENET_MEAN) / IMAGENET_STD
        return np.expand_dims(x.transpose(2, 0, 1), axis=0)

    def process_frame(self, frame_bgr: np.ndarray, out_index: int, ctx: ExtractionContext) -> None:
        x = self._preprocess(frame_bgr)
        depth = self.session.run(None, {self.input_name: x})[0][0]  # [H, W] inverse depth

        w, h = ctx.out_size
        depth = cv2.resize(depth, (w, h), interpolation=cv2.INTER_LINEAR)
        # Per-frame min-max normalization (v1). Higher raw value = closer,
        # so this yields the ControlNet convention of white = near.
        dmin, dmax = float(depth.min()), float(depth.max())
        if dmax - dmin < 1e-6:
            gray = np.zeros((h, w), dtype=np.uint8)
        else:
            gray = ((depth - dmin) / (dmax - dmin) * 255.0).astype(np.uint8)
        imwrite_unicode(self.out / f"frame_{out_index:06d}.png", gray)

    def finalize(self, ctx: ExtractionContext) -> dict:
        return {"model": self.model_label, "normalization": "per_frame"}
