"""Scene layout channel: per-frame semantic segmentation → a layered 2.5D
blockout scene (services/layout_scene.py) rendered as simple primitives.

Per shot this produces:
- layout/ids/     : raw class-id maps (uint8, 0-149) — analysis source of truth
- layout/scene.json : backdrop (smoothed horizon + ground ramp) and tracked
  instances (person/vehicle/building/... as capsules / rounded boxes)
- layout/         : scene rendered in the official ADE20K palette (flat exact
  colors → ControlNet-Seg plug-and-play)
- blockout/       : scene rendered in grouped colors with depth shading — the
  3D-blockout look for I2V reference

Hybrid extraction — each layer by the tool that's best at it:
- people: pose keypoints (stabler than blobs);
- vehicles/props: a COCO object detector (YOLOX, Apache-2.0) — one box per
  object, so an occluder no longer splits a car into two, and labels are sharp;
- buildings/trees + backdrop (sky/ground/materials/horizon): TopFormer (ADE20K,
  Apache-2.0) segmentation.
The detector is optional; without its model, layout degrades to seg-only.
"""

import json
from pathlib import Path

import cv2
import numpy as np

from app.extractors.base import ExtractionContext, FrameExtractor, register_extractor
from app.extractors.depth import _providers_for
from app.services import layout_scene, model_manager, object_detect
from app.services.video_io import imwrite_unicode

SEG_SIZE = 512  # TopFormer fixed input
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

_ASSET = Path(__file__).resolve().parents[1] / "assets" / "ade20k.json"
_COCO_ASSET = Path(__file__).resolve().parents[1] / "assets" / "coco_labels.json"

# Only these fg groups become subject candidates (vehicles + props). Buildings,
# trees and everything else are backdrop only — not marked. Detector owns these
# when present; the seg fallback extracts the same groups.
OBJECT_GROUPS = {"vehicle", "props"}


def load_ade20k() -> dict:
    """Class names, official palette, blockout groups — shared BE/FE source."""
    return json.loads(_ASSET.read_text(encoding="utf-8"))


def load_coco() -> dict:
    """COCO detector labels → layout groups + representative ADE class ids."""
    return json.loads(_COCO_ASSET.read_text(encoding="utf-8"))


# ---------- id-map colorization utilities (kept for tooling/tests) ----------


def ade_lut(meta: dict, disabled: set[str] | None = None) -> np.ndarray:
    """(150, 3) BGR lookup table for the official ADE20K palette."""
    lut = np.array(meta["palette"], np.uint8)[:, ::-1].copy()
    for idx, group in enumerate(meta["groups"]):
        if disabled and group in disabled:
            lut[idx] = 0
    return lut


def blockout_lut(meta: dict, disabled: set[str] | None = None) -> np.ndarray:
    """(150, 3) BGR lookup table for the grouped blockout palette."""
    disabled = disabled or set()
    lut = np.zeros((150, 3), np.uint8)
    for idx, group in enumerate(meta["groups"]):
        if group not in disabled:
            lut[idx] = np.array(meta["blockout_palette"][group], np.uint8)[::-1]
    return lut


def colorize_ids(ids: np.ndarray, lut: np.ndarray) -> np.ndarray:
    """Class-id map (h, w) → BGR color map via a (150, 3) LUT."""
    return lut[ids]


def shade_by_depth(color: np.ndarray, depth_gray: np.ndarray) -> np.ndarray:
    """Depth cue: near (white in depth) = bright, far = dim."""
    h, w = color.shape[:2]
    if depth_gray.shape[:2] != (h, w):
        depth_gray = cv2.resize(depth_gray, (w, h), interpolation=cv2.INTER_LINEAR)
    factor = 0.55 + 0.45 * (depth_gray.astype(np.float32) / 255.0)
    return np.clip(color.astype(np.float32) * factor[..., None], 0, 255).astype(np.uint8)


# ---------- extractor ----------


@register_extractor
class LayoutExtractor(FrameExtractor):
    """Semantic blockout: backdrop planes + tracked instance primitives."""

    name = "layout"
    requires_models = ["topformer_ade20k"]

    def prepare(self, ctx: ExtractionContext) -> None:
        import onnxruntime as ort

        model_file = model_manager.model_path("topformer_ade20k")
        if not model_file.exists():
            raise RuntimeError("Scene layout model not downloaded yet — it fetches on first use")
        providers = _providers_for(ctx.ort_provider, ort.get_available_providers())
        self.session = ort.InferenceSession(str(model_file), providers=providers)
        self.input_name = self.session.get_inputs()[0].name

        self.meta = load_ade20k()
        self.roles = layout_scene.scene_roles(self.meta)
        self.person_index = int(self.meta["person_index"])

        # Foreground detector (vehicles/props). Optional: if the model isn't
        # present, layout degrades gracefully to segmentation-only extraction.
        layout_model = str(ctx.app_settings.get("layout_model", "fast"))
        det_file = model_manager.detector_model_path(layout_model)
        self.detector = None
        if det_file.exists():
            self.coco = load_coco()
            self.detector = object_detect.ObjectDetector(det_file, providers)

        self.per_frame: list[list[dict]] = []
        self.horizons: list[np.ndarray] = []
        self.shades: list[list[float]] = []
        self.class_counts = np.zeros(150, np.int64)

        self.out = self.output_dir(ctx)  # layout/
        self.ids_dir = self.out / "ids"
        self.block_dir = ctx.shot_dir / "blockout"
        import shutil

        shutil.rmtree(self.block_dir, ignore_errors=True)  # pipeline cleans layout/ only
        for d in (self.out, self.ids_dir, self.block_dir):
            d.mkdir(parents=True, exist_ok=True)

    def _infer_ids(self, frame_bgr: np.ndarray) -> np.ndarray:
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        x = cv2.resize(rgb, (SEG_SIZE, SEG_SIZE), interpolation=cv2.INTER_AREA).astype(np.float32)
        x = (x / 255.0 - _MEAN) / _STD
        x = np.expand_dims(x.transpose(2, 0, 1), 0).astype(np.float32)
        logits = self.session.run(None, {self.input_name: x})[0][0]  # (150, h', w')
        return np.argmax(logits, axis=0).astype(np.uint8)

    def _detector_instances(
        self, frame_bgr: np.ndarray, depth: np.ndarray | None, size: tuple[int, int]
    ) -> list[dict]:
        """Detector boxes → instance dicts (vehicles/props), with per-box depth
        and color for the tracker. One box per object survives occlusion."""
        w, h = size
        groups, ade_repr, drop = self.coco["groups"], self.coco["ade_repr"], set(self.coco["drop"])
        out: list[dict] = []
        for det in self.detector.detect(frame_bgr):
            group = groups[det["cls"]]
            if group in drop or group not in OBJECT_GROUPS:
                continue
            x, y, bw, bh = det["box"]
            d = 0.5
            if depth is not None:
                patch = depth[max(0, y) : min(h, y + bh), max(0, x) : min(w, x + bw)]
                if patch.size:
                    d = round(float(np.median(patch)) / 255.0, 3)
            patch = frame_bgr[max(0, y) : min(h, y + bh), max(0, x) : min(w, x + bw)]
            color = None
            if patch.size:
                bgr = np.median(patch.reshape(-1, 3), axis=0)
                color = [int(bgr[2]), int(bgr[1]), int(bgr[0])]
            out.append(
                {"group": group, "cls": int(ade_repr.get(group, 0)),
                 "box": [x, y, bw, bh], "d": d, "color": color}
            )
        return out

    def process_frame(self, frame_bgr: np.ndarray, out_index: int, ctx: ExtractionContext) -> None:
        w, h = ctx.out_size
        ids = self._infer_ids(frame_bgr)
        ids = cv2.resize(ids, (w, h), interpolation=cv2.INTER_NEAREST)

        depth = None
        depth_path = ctx.shot_dir / "depth" / f"frame_{out_index:06d}.png"
        if depth_path.exists():
            depth = cv2.imdecode(np.fromfile(depth_path, np.uint8), cv2.IMREAD_GRAYSCALE)

        self.class_counts += np.bincount(ids.ravel(), minlength=150)
        self.horizons.append(layout_scene.estimate_horizon(ids, self.roles))
        self.shades.append(layout_scene.ground_shade(ids, depth, self.roles["bottom"]))

        # Subjects = objects (detector, or seg fallback) + people (from pose, in
        # finalize). Buildings/trees/backdrop are not marked.
        if self.detector is not None:
            dets = self._detector_instances(frame_bgr, depth, (w, h))
        else:
            dets = layout_scene.extract_instances(
                ids, depth, self.roles, frame_bgr=frame_bgr, groups=OBJECT_GROUPS
            )
        self.per_frame.append(dets)

        imwrite_unicode(self.ids_dir / f"frame_{out_index:06d}.png", ids)

    def _persons_from_pose(self, ctx: ExtractionContext) -> None:
        """Prefer pose keypoints for person instances: skeleton boxes are far
        more stable than segmentation blobs. Replaces the person detections in
        self.per_frame in place (depth sampled per box for the shading cue)."""
        kp_path = ctx.shot_dir / "pose" / "keypoints.json"
        if not kp_path.exists():
            return
        try:
            kp_data = json.loads(kp_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        persons = layout_scene.persons_from_pose(
            kp_data, ctx.out_size, len(self.per_frame), self.person_index
        )
        if persons is None:
            return
        for t, dets in enumerate(self.per_frame):
            pose_dets = persons[t]
            if not pose_dets:
                # pose saw nobody: keep the segmentation persons (they may
                # still catch small/dim figures)
                continue
            depth_path = ctx.shot_dir / "depth" / f"frame_{t:06d}.png"
            depth = (
                cv2.imdecode(np.fromfile(depth_path, np.uint8), cv2.IMREAD_GRAYSCALE)
                if depth_path.exists()
                else None
            )
            frame_path = ctx.shot_dir / "frames" / f"frame_{t:06d}.jpg"
            frame = (
                cv2.imdecode(np.fromfile(frame_path, np.uint8), cv2.IMREAD_COLOR)
                if frame_path.exists()
                else None
            )
            for det in pose_dets:
                x, y, w, h = det["box"]
                if depth is not None:
                    dh, dw = depth.shape[:2]
                    patch = depth[max(0, y) : min(dh, y + h), max(0, x) : min(dw, x + w)]
                    if patch.size:
                        det["d"] = round(float(np.median(patch)) / 255.0, 3)
                if frame is not None:
                    # torso window: the identity color (jacket) lives here
                    fh, fw = frame.shape[:2]
                    ty0, ty1 = y + int(h * 0.22), y + int(h * 0.55)
                    tx0, tx1 = x + int(w * 0.25), x + int(w * 0.75)
                    torso = frame[max(0, ty0) : min(fh, ty1), max(0, tx0) : min(fw, tx1)]
                    if torso.size:
                        bgr = np.median(torso.reshape(-1, 3), axis=0)
                        det["color"] = [int(bgr[2]), int(bgr[1]), int(bgr[0])]
            self.per_frame[t] = [d for d in dets if d["group"] != "person"] + pose_dets

    def finalize(self, ctx: ExtractionContext) -> dict:
        self._persons_from_pose(ctx)
        top_counts = np.where(np.isin(np.arange(150), list(self.roles["top"])), self.class_counts, 0)
        bottom_counts = np.where(
            np.isin(np.arange(150), list(self.roles["bottom"])), self.class_counts, 0
        )
        scene = layout_scene.build_scene(
            self.per_frame, self.horizons, self.shades, top_counts, bottom_counts, ctx.out_size,
        )
        layout_scene.scene_path(ctx.shot_dir).write_text(
            json.dumps(scene, ensure_ascii=False), encoding="utf-8"
        )

        # Baked previews show the auto-selected (salient) subjects only; the rest
        # are candidates the director can enable in the panel.
        hidden = layout_scene.hidden_instances(scene, None)
        for i in range(scene["frame_count"]):
            imwrite_unicode(
                self.out / f"frame_{i:06d}.png",
                layout_scene.render_frame(scene, self.meta, i, palette="ade", disabled_instances=hidden),
            )
            imwrite_unicode(
                self.block_dir / f"frame_{i:06d}.png",
                layout_scene.render_frame(scene, self.meta, i, palette="blockout", disabled_instances=hidden),
            )

        counts: dict[str, int] = {}
        for inst in scene["instances"]:
            if inst.get("auto"):
                counts[inst["group"]] = counts.get(inst["group"], 0) + 1
        return {
            "model": "topformer_ade20k",
            "detector": (
                model_manager.detector_key_for(str(ctx.app_settings.get("layout_model", "fast")))
                if self.detector is not None
                else None
            ),
            "mode": "scene",
            "instances": counts,
            "top_class": scene["top_class"],
            "bottom_class": scene["bottom_class"],
        }
