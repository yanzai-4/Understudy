"""Importing this package registers all available extractors."""

from app.extractors.base import EXTRACTOR_REGISTRY, FrameExtractor  # noqa: F401
from app.extractors import depth, layout, pose  # noqa: F401
