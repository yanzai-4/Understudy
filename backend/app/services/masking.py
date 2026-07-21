"""Subject-mask compositing shared by the subject extractor and the exporter.

The subject channel stores a per-frame grayscale alpha (white = person). To
scope another control signal to the subject, we intersect it with a binarized
version of that alpha — non-destructive: the raw channels stay full-frame and
scoping is decided at export/preview time.
"""

import cv2
import numpy as np


def subject_binary(mask_gray: np.ndarray, thresh: float = 0.5) -> np.ndarray:
    """Binarize a 0-255 subject alpha at `thresh` (0..1)."""
    _, binary = cv2.threshold(mask_gray, int(thresh * 255), 255, cv2.THRESH_BINARY)
    return binary


def mask_channel(channel_img: np.ndarray, mask_gray: np.ndarray, thresh: float = 0.5) -> np.ndarray:
    """Keep channel pixels where the subject alpha exceeds `thresh`, else black.

    `channel_img` may be grayscale (canny/depth) or BGR; the mask is resized to
    match the channel if needed.
    """
    h, w = channel_img.shape[:2]
    if mask_gray.shape[:2] != (h, w):
        mask_gray = cv2.resize(mask_gray, (w, h), interpolation=cv2.INTER_LINEAR)
    binary = subject_binary(mask_gray, thresh)
    if channel_img.ndim == 3:
        binary = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    return cv2.bitwise_and(channel_img, binary)
