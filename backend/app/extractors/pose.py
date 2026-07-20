import json

import numpy as np

from app.extractors.base import ExtractionContext, FrameExtractor, register_extractor
from app.services.model_manager import RTMLIB_KEY
from app.services.video_io import imwrite_unicode

KPT_THRESHOLD = 0.5


@register_extractor
class PoseExtractor(FrameExtractor):
    """OpenPose-style skeletons on black, drawn from RTMPose (via rtmlib)."""

    name = "pose"
    requires_models = [RTMLIB_KEY]

    def prepare(self, ctx: ExtractionContext) -> None:
        from rtmlib import Body, draw_skeleton

        self._draw = draw_skeleton
        # CPU is fast enough for pose; DirectML support can be injected later
        # through rtmlib's RTMLIB_SETTINGS provider map.
        self.body = Body(mode="balanced", backend="onnxruntime", device="cpu", to_openpose=True)
        self.out = self.output_dir(ctx)
        self.out.mkdir(parents=True, exist_ok=True)
        self.keypoints_log: list[dict] = []
        self.missing_frames = 0

    def process_frame(self, frame_bgr: np.ndarray, out_index: int, ctx: ExtractionContext) -> None:
        keypoints, scores = self.body(frame_bgr)
        canvas = np.zeros_like(frame_bgr)

        detected = keypoints is not None and len(keypoints) > 0
        if detected:
            canvas = self._draw(
                canvas, keypoints, scores, openpose_skeleton=True, kpt_thr=KPT_THRESHOLD
            )
            self.keypoints_log.append(
                {
                    "frame": out_index,
                    "people": [
                        {
                            "keypoints": np.round(person, 2).tolist(),
                            "scores": np.round(person_scores, 3).tolist(),
                        }
                        for person, person_scores in zip(keypoints, scores)
                    ],
                }
            )
        else:
            self.missing_frames += 1
            self.keypoints_log.append({"frame": out_index, "people": []})

        imwrite_unicode(self.out / f"frame_{out_index:06d}.png", canvas)

    def finalize(self, ctx: ExtractionContext) -> dict:
        (self.out / "keypoints.json").write_text(
            json.dumps(
                {"format": "openpose_body", "frames": self.keypoints_log},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return {
            "model": "rtmpose-m body7 (rtmlib balanced, openpose format)",
            "missing_frames": self.missing_frames,
        }
