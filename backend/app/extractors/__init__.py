"""Importing this package registers all available extractors."""

from app.extractors.base import EXTRACTOR_REGISTRY, FrameExtractor  # noqa: F401
from app.extractors import canny, depth, pose  # noqa: F401
