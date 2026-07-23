"""Build docs/feature-manage.png — a diagonal (bottom-left -> top-right) split
that merges the storyboard and whiteboard screenshots into one figure.

The storyboard fills the top-left triangle, the whiteboard the bottom-right,
joined along the anti-diagonal.

Usage (from the repo root, venv active):
    python scripts/make_manage_figure.py docs/_storyboard.png docs/_whiteboard.png
Optionally a third arg for the output path (defaults to docs/feature-manage.png).
"""
import sys
from pathlib import Path

import cv2
import numpy as np


def merge(a_path: str, b_path: str, out: str = "docs/feature-manage.png") -> None:
    a = cv2.imread(a_path)
    b = cv2.imread(b_path)
    if a is None or b is None:
        raise SystemExit(f"could not read one of: {a_path}, {b_path}")

    h = min(a.shape[0], b.shape[0])
    w = min(a.shape[1], b.shape[1])
    a = cv2.resize(a, (w, h))
    b = cv2.resize(b, (w, h))

    # Anti-diagonal from bottom-left (0,h) to top-right (w,0): x/w + y/h == 1.
    # f == 0 on the line; < 0 = top-left triangle -> storyboard (a).
    xs = np.arange(w)[None, :].astype(np.float32) / w
    ys = np.arange(h)[:, None].astype(np.float32) / h
    f = xs + ys - 1.0
    k = float(np.hypot(1.0 / w, 1.0 / h))  # change in f per pixel (along the normal)

    # Anti-aliased edge: a ~4px soft transition instead of a jagged hard cut.
    t = np.clip(0.5 - f / (4.0 * k), 0.0, 1.0)[..., None]  # 1 -> a (top-left), 0 -> b
    out_img = a.astype(np.float32) * t + b.astype(np.float32) * (1.0 - t)

    # Elegant divider: a soft feathered line in a muted steel-blue (on-brand),
    # not a harsh white stripe.
    glow = np.exp(-((f / (3.0 * k)) ** 2))[..., None]  # gaussian ~3px sigma
    line_bgr = np.array([200, 168, 132], np.float32)  # soft steel-blue (BGR)
    out_img = out_img * (1.0 - 0.5 * glow) + line_bgr * (0.5 * glow)
    out_img = np.clip(out_img, 0, 255).astype(np.uint8)

    Path(out).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(out, out_img)
    print(f"wrote {out} ({w}x{h})")


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2:
        raise SystemExit(__doc__)
    merge(*args)
