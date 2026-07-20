"""Generate the Understudy logo assets:
- understudy.ico  (multi-size: 16/24/32/48/64/256, PNG-compressed entries)
- logo_256.png    (preview / repo asset)

Concept: the letter U drawn as an OpenPose-style bone chain — three glowing
keypoint joints connected by a thick cyan→blue stroke — on a deep night tile
with viewfinder corner brackets (dropped at small sizes for legibility).
Drawn oversized with cv2 then area-downsampled for clean anti-aliasing.
"""

import struct
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
MASTER = 1024  # master canvas, geometry expressed in a 64-unit grid
G = MASTER / 64.0

# Palette (BGR)
TILE_TOP = (38, 21, 12)      # #0c1526
TILE_BOTTOM = (63, 35, 22)   # #16233f
BRACKET = (136, 84, 58)      # #3a5488
CYAN = (248, 189, 56)        # #38bdf8
BLUE = (246, 123, 63)        # #3f7bf6
JOINT_CORE = (255, 247, 234) # #eaf7ff
JOINT_GLOW = (250, 205, 110) # soft cyan glow

# U-as-skeleton geometry (64-unit grid)
X_L, X_R = 22.5, 41.5
Y_TOP, Y_ARC = 21.0, 33.5
RADIUS = (X_R - X_L) / 2.0
CX, CY_BOTTOM = 32.0, Y_ARC + RADIUS
STROKE = 5.6


def px(v: float) -> int:
    return int(round(v * G))


def _rounded_mask(size: int, radius: int) -> np.ndarray:
    m = np.zeros((size, size), np.uint8)
    r = radius
    cv2.rectangle(m, (r, 0), (size - r, size), 255, -1)
    cv2.rectangle(m, (0, r), (size, size - r), 255, -1)
    for cx, cy in [(r, r), (size - r, r), (r, size - r), (size - r, size - r)]:
        cv2.circle(m, (cx, cy), r, 255, -1)
    return m


def _tile() -> np.ndarray:
    """Vertical night gradient + a soft cyan-blue glow in the upper right."""
    t = np.linspace(0.0, 1.0, MASTER, dtype=np.float32)[:, None, None]
    img = (1 - t) * np.array(TILE_TOP, np.float32) + t * np.array(TILE_BOTTOM, np.float32)
    img = np.repeat(img, MASTER, axis=1)

    yy, xx = np.mgrid[0:MASTER, 0:MASTER].astype(np.float32)
    gx, gy, grad_r = 0.78 * MASTER, 0.16 * MASTER, 0.72 * MASTER
    glow = np.clip(1.0 - np.sqrt((xx - gx) ** 2 + (yy - gy) ** 2) / grad_r, 0, 1) ** 2
    img += glow[..., None] * np.array((90, 60, 18), np.float32) * 0.35
    return np.clip(img, 0, 255).astype(np.uint8)


def _stroke_gradient() -> np.ndarray:
    """Diagonal cyan(top-left) → blue(bottom-right) fill for the bone stroke."""
    yy, xx = np.mgrid[0:MASTER, 0:MASTER].astype(np.float32)
    t = np.clip((xx + yy) / (2 * MASTER), 0, 1)[..., None]
    return ((1 - t) * np.array(CYAN, np.float32) + t * np.array(BLUE, np.float32)).astype(np.uint8)


def _draw_u_mask(thickness: float) -> np.ndarray:
    m = np.zeros((MASTER, MASTER), np.uint8)
    th = px(thickness)
    cv2.line(m, (px(X_L), px(Y_TOP)), (px(X_L), px(Y_ARC)), 255, th, cv2.LINE_AA)
    cv2.line(m, (px(X_R), px(Y_TOP)), (px(X_R), px(Y_ARC)), 255, th, cv2.LINE_AA)
    cv2.ellipse(m, (px(CX), px(Y_ARC)), (px(RADIUS), px(RADIUS)), 0, 0, 180, 255, th, cv2.LINE_AA)
    # round caps at the top joints
    for x in (X_L, X_R):
        cv2.circle(m, (px(x), px(Y_TOP)), th // 2, 255, -1, cv2.LINE_AA)
    return m


def _joints(img: np.ndarray, glow: bool, core_r: float, glow_r: float) -> None:
    points = [(X_L, Y_TOP), (X_R, Y_TOP), (CX, CY_BOTTOM)]
    if glow:
        layer = np.zeros_like(img)
        for jx, jy in points:
            cv2.circle(layer, (px(jx), px(jy)), px(glow_r), JOINT_GLOW, -1, cv2.LINE_AA)
        k = px(2.6) | 1
        layer = cv2.GaussianBlur(layer, (k, k), 0)
        img[:] = np.clip(img.astype(np.int32) + layer.astype(np.int32) * 0.55, 0, 255).astype(np.uint8)
    for jx, jy in points:
        cv2.circle(img, (px(jx), px(jy)), px(core_r), JOINT_CORE, -1, cv2.LINE_AA)


def _brackets(img: np.ndarray) -> None:
    inset, length, th = 9.0, 9.0, 2.1
    t = px(th)
    for cx, sx in ((inset, 1), (64 - inset, -1)):
        for cy, sy in ((inset, 1), (64 - inset, -1)):
            p = (px(cx), px(cy))
            cv2.line(img, p, (px(cx + sx * length), px(cy)), BRACKET, t, cv2.LINE_AA)
            cv2.line(img, p, (px(cx), px(cy + sy * length)), BRACKET, t, cv2.LINE_AA)


def render(size: int) -> np.ndarray:
    """Render one BGRA icon frame at `size` px."""
    simple = size <= 32  # small sizes: no brackets/glow, thicker bones
    img = _tile()
    if not simple:
        _brackets(img)

    u_mask = _draw_u_mask(STROKE + (1.6 if simple else 0.0))
    grad = _stroke_gradient()
    img[u_mask > 0] = grad[u_mask > 0]

    _joints(img, glow=not simple, core_r=3.4 if simple else 2.8, glow_r=4.2)

    alpha = _rounded_mask(MASTER, px(14))
    out = cv2.merge([*cv2.split(img), alpha])
    return cv2.resize(out, (size, size), interpolation=cv2.INTER_AREA)


def write_ico(path: Path, sizes: list[int]) -> None:
    entries = []
    for s in sizes:
        ok, png = cv2.imencode(".png", render(s))
        assert ok, f"encode failed at {s}"
        entries.append((s, png.tobytes()))

    with path.open("wb") as f:
        f.write(struct.pack("<HHH", 0, 1, len(entries)))
        offset = 6 + 16 * len(entries)
        for s, data in entries:
            dim = 0 if s >= 256 else s
            f.write(struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset))
            offset += len(data)
        for _, data in entries:
            f.write(data)


if __name__ == "__main__":
    write_ico(HERE / "understudy.ico", [16, 24, 32, 48, 64, 256])
    cv2.imwrite(str(HERE / "logo_256.png"), render(256))
    cv2.imwrite(str(HERE / "logo_32.png"), render(32))
    print("wrote understudy.ico + logo_256.png + logo_32.png")
