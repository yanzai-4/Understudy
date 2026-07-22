"""Extractor plugin interface.

New control signals (e.g. camera-motion, external caption APIs) plug in by
subclassing FrameExtractor and decorating with @register_extractor — the
pipeline, API and export layers discover them through EXTRACTOR_REGISTRY.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, ClassVar

import numpy as np


@dataclass
class ExtractionContext:
    shot_dir: Path  # data/films/<film>/shots/<shot>
    out_size: tuple[int, int]  # (width, height) after long-edge cap
    stride: int
    effective_fps: float
    total_out_frames: int
    ort_provider: str  # 'cpu' | 'directml' (Windows) | 'coreml' (macOS)
    models_dir: Path
    app_settings: dict  # settings-table snapshot (depth model variant, ...)
    is_cancelled: Callable[[], bool]


class FrameExtractor(ABC):
    name: ClassVar[str]
    # Keys resolved by services.model_manager before prepare() runs.
    requires_models: ClassVar[list[str]] = []

    @abstractmethod
    def prepare(self, ctx: ExtractionContext) -> None:
        """Load models / allocate resources. Raising aborts the whole task."""

    @abstractmethod
    def process_frame(self, frame_bgr: np.ndarray, out_index: int, ctx: ExtractionContext) -> None:
        """Consume one (already resized) BGR frame; write <name>/frame_%06d.png."""

    def finalize(self, ctx: ExtractionContext) -> dict:
        """Write auxiliary files; return a summary stored in extraction.json."""
        return {}

    def output_dir(self, ctx: ExtractionContext) -> Path:
        return ctx.shot_dir / self.name


EXTRACTOR_REGISTRY: dict[str, type[FrameExtractor]] = {}


def register_extractor(cls: type[FrameExtractor]) -> type[FrameExtractor]:
    EXTRACTOR_REGISTRY[cls.name] = cls
    return cls
