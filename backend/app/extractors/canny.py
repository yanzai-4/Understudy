import cv2
import numpy as np

from app.extractors.base import ExtractionContext, FrameExtractor, register_extractor
from app.services.video_io import imwrite_unicode


@register_extractor
class CannyExtractor(FrameExtractor):
    """Edge maps: white lines on black, the standard ControlNet canny format."""

    name = "canny"

    def prepare(self, ctx: ExtractionContext) -> None:
        self.low = int(ctx.app_settings.get("canny_low", 100))
        self.high = int(ctx.app_settings.get("canny_high", 200))
        self.out = self.output_dir(ctx)
        self.out.mkdir(parents=True, exist_ok=True)

    def process_frame(self, frame_bgr: np.ndarray, out_index: int, ctx: ExtractionContext) -> None:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        edges = cv2.Canny(blurred, self.low, self.high)
        imwrite_unicode(self.out / f"frame_{out_index:06d}.png", edges)

    def finalize(self, ctx: ExtractionContext) -> dict:
        return {"low_threshold": self.low, "high_threshold": self.high}
