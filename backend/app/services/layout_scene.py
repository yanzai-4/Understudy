"""Layered 2.5D scene proxy — the "blockout" behind the layout channel.

Instead of colorizing raw segmentation, each frame is decomposed like a 3D
blockout scene:

- A **backdrop** that is always complete: a smoothed horizon curve splits the
  frame into a top plane (sky / ceiling) and a ground plane (road / floor /
  grass / water / vegetation — scenery belongs to the backdrop, so treelines
  simply lift the smoothed silhouette), the ground shaded as a smooth near→far
  ramp fitted from depth.
- **Instances**: connected components of the object classes (person / vehicle /
  building / props), tracked across frames, filtered of specks, and rendered
  as simple primitives — capsules for people, rounded boxes for everything
  else.

Deleting an instance simply skips its primitive, so the backdrop shows through
and nothing is ever left as a hole. Rendering is mirrored in
frontend/src/lib/layoutScene.ts — keep them in sync.
"""

import json
from pathlib import Path

import cv2
import numpy as np

HORIZON_POINTS = 64
MIN_AREA_FRAC = 0.004  # specks below this fraction of the frame are noise
MAX_AREA_FRAC = 0.55  # blobs beyond this are effectively backdrop (e.g. a wall filling the view)
MIN_TRACK_FRAMES = 3
TRACK_MAX_GAP = 4
POS_EMA = 0.45  # position responds faster…
SIZE_EMA = 0.2  # …than size, which barely breathes
SIZE_CLAMP = 0.10  # max relative size change per frame for moving objects
STATIC_DISP_FRAC = 0.02  # tracks moving less than this (of the diagonal) freeze solid
STATIC_FULL_RANGE = 0.7  # static tracks seen in ≥70% of frames persist for the whole shot
COLOR_GATE = 95.0  # max RGB L2 distance for a match (identity through overlaps)
COLOR_EMA = 0.2
COLOR_BONUS = 0.2  # weight of color similarity in the match score
HORIZON_EMA = 0.25
SHADE_EMA = 0.3
SHADE_MIN, SHADE_SPAN = 0.55, 0.45
POSE_SCORE_THR = 0.3
MIN_POSE_POINTS = 5
# A person primitive is a marker ("someone is here"), not a silhouette: lock
# its aspect so limb spread never deforms the capsule — articulation is the
# pose channel's job.
PERSON_ASPECT = 0.38  # width / height

# OpenPose-18 landmarks at known fractions of standing body height (head=0,
# feet=1). Partial skeletons (e.g. legs only) still yield the FULL body box:
# height is solved from any two landmark rows. Arms are excluded (pose-driven).
POSE_HEIGHT_FRACTIONS: dict[int, float] = {
    0: 0.06,  # nose
    14: 0.04, 15: 0.04,  # eyes
    16: 0.05, 17: 0.05,  # ears
    1: 0.18,  # neck
    2: 0.18, 5: 0.18,  # shoulders
    8: 0.52, 11: 0.52,  # hips
    9: 0.72, 12: 0.72,  # knees
    10: 0.95, 13: 0.95,  # ankles
}
MIN_FRACTION_SPREAD = 0.10  # need two landmark rows at least this far apart

TOP_CLASS_NAMES = {"sky", "ceiling"}
# ground-cover vegetation is a ground MATERIAL (backdrop); volumetric
# vegetation (trees, bushes...) stays a scenery block you can toggle
GROUND_COVER_NAMES = {"grass", "field", "mountain", "hill"}

# The ground plane can mix materials (a lawn beside a road): the dominant one
# is the plane's base color and the others render as smoothed patch polygons.
MATERIAL_GRID = (48, 27)  # (cols, rows) occupancy grid per frame
MATERIAL_EMA = 0.3
MATERIAL_MIN_COVER = 0.03  # of the frame, averaged over the shot
PATCH_MIN_AREA_FRAC = 0.01
PATCH_MAX_POLYS = 4


# ---------- roles ----------


def scene_roles(meta: dict) -> dict:
    """Split the 150 classes into backdrop roles and object groups.

    Backdrop = sky/ceiling on top; ground, water and ground-cover vegetation
    below (surface material). Objects = person / vehicle / building / props +
    volumetric vegetation (trees, bushes — the "nature" scenery blocks)."""
    top_ids, bottom_ids, fg = set(), set(), {}
    materials: dict[str, set[int]] = {"paved": set(), "veg": set(), "water": set()}
    for idx, (name, group) in enumerate(zip(meta["classes"], meta["groups"])):
        if name in TOP_CLASS_NAMES:
            top_ids.add(idx)
        elif group in ("ground", "water") or name in GROUND_COVER_NAMES:
            bottom_ids.add(idx)
            if name in GROUND_COVER_NAMES:
                materials["veg"].add(idx)
            elif group == "water":
                materials["water"].add(idx)
            else:
                materials["paved"].add(idx)
        else:
            fg[idx] = group
    return {"top": top_ids, "bottom": bottom_ids, "fg": fg, "materials": materials}


# ---------- per-frame analysis ----------


def _smooth_1d(values: np.ndarray, window: int) -> np.ndarray:
    window = max(3, window | 1)
    pad = window // 2
    padded = np.pad(values, pad, mode="edge")
    kernel = np.ones(window, np.float32) / window
    return np.convolve(padded, kernel, mode="valid")


def estimate_horizon(ids: np.ndarray, roles: dict) -> np.ndarray:
    """Smoothed per-column boundary between the ground plane and the rest,
    downsampled to HORIZON_POINTS control values (y pixels).

    Columns whose boundary is occluded by a foreground object (a person/car
    standing on the line) are treated as unknown and bridged from their
    neighbors, so the boundary runs continuously behind objects — deleting the
    object later reveals a seamless backdrop."""
    h, w = ids.shape
    bottom_mask = np.isin(ids, list(roles["bottom"]))
    has = bottom_mask.any(axis=0)
    first = bottom_mask.argmax(axis=0).astype(np.float32)

    # occluded: the pixel just above the found boundary is a foreground object
    fg_mask = np.isin(ids, list(roles["fg"].keys()))
    above = np.clip(first.astype(int) - 2, 0, h - 1)
    occluded = fg_mask[above, np.arange(w)]

    ys = np.where(has & ~occluded, first, np.nan)
    valid = ~np.isnan(ys)
    if valid.sum() < w * 0.05:
        ys = np.where(has, first, h * 0.72).astype(np.float32)  # fall back to raw
    else:
        xs = np.arange(w)
        ys = np.interp(xs, xs[valid], ys[valid]).astype(np.float32)

    ys = _smooth_1d(ys, w // 8)
    ctrl_x = np.linspace(0, w - 1, HORIZON_POINTS)
    return np.clip(np.interp(ctrl_x, np.arange(w), ys), 0, h - 1)


def material_grids(ids: np.ndarray, roles: dict) -> dict[str, np.ndarray]:
    """Coarse occupancy grid per ground material (paved/veg/water) — the raw
    input for the smoothed material patches on the ground plane."""
    cols, rows = MATERIAL_GRID
    out = {}
    for name, id_set in roles["materials"].items():
        if not id_set:
            out[name] = np.zeros((rows, cols), np.float32)
            continue
        mask = np.isin(ids, list(id_set)).astype(np.float32)
        out[name] = cv2.resize(mask, (cols, rows), interpolation=cv2.INTER_AREA)
    return out


def _material_polys(
    grids: list[np.ndarray], size: tuple[int, int]
) -> list[list[list[list[int]]]]:
    """Temporal-EMA the occupancy grids, then per frame: upsample → blur →
    threshold → simplified contours. Output: per frame, a list of polygons."""
    w, h = size
    qw, qh = max(8, w // 4), max(8, h // 4)
    eps = 0.012 * ((qw * qw + qh * qh) ** 0.5)
    min_area_q = PATCH_MIN_AREA_FRAC * qw * qh

    frames_out: list[list[list[list[int]]]] = []
    ema = None
    for grid in grids:
        ema = grid if ema is None else MATERIAL_EMA * grid + (1 - MATERIAL_EMA) * ema
        up = cv2.resize(ema, (qw, qh), interpolation=cv2.INTER_LINEAR)
        up = cv2.GaussianBlur(up, (9, 9), 0)
        binary = (up > 0.45).astype(np.uint8)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        polys = []
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:PATCH_MAX_POLYS]:
            if cv2.contourArea(c) < min_area_q:
                continue
            approx = cv2.approxPolyDP(c, eps, True)
            if len(approx) < 3:
                continue
            pts = (approx.reshape(-1, 2).astype(np.float32) * [w / qw, h / qh]).round().astype(int)
            polys.append(pts.tolist())
        frames_out.append(polys)
    return frames_out


def ground_shade(ids: np.ndarray, depth: np.ndarray | None, bottom_ids: set[int]) -> list[float]:
    """[factor_at_horizon, factor_at_bottom] for the ground ramp (near=bright).
    Fitted linearly over the ground pixels' depth; sane default without depth."""
    if depth is None:
        return [SHADE_MIN + SHADE_SPAN * 0.3, 1.0]
    h, w = ids.shape
    if depth.shape[:2] != (h, w):
        depth = cv2.resize(depth, (w, h), interpolation=cv2.INTER_LINEAR)
    mask = np.isin(ids, list(bottom_ids))
    ys, xs = np.nonzero(mask)
    if ys.size < 50:
        return [SHADE_MIN + SHADE_SPAN * 0.3, 1.0]
    sel = np.random.RandomState(0).choice(ys.size, min(4000, ys.size), replace=False)
    yv = ys[sel].astype(np.float32)
    dv = depth[ys[sel], xs[sel]].astype(np.float32) / 255.0
    a, b = np.polyfit(yv, dv, 1)
    y0, y1 = float(ys.min()), float(h - 1)
    f = lambda y: SHADE_MIN + SHADE_SPAN * float(np.clip(a * y + b, 0, 1))
    return [round(f(y0), 3), round(f(y1), 3)]


def extract_instances(
    ids: np.ndarray,
    depth: np.ndarray | None,
    roles: dict,
    min_area_frac: float = MIN_AREA_FRAC,
    frame_bgr: np.ndarray | None = None,
) -> list[dict]:
    """Connected components of foreground classes → raw instance boxes.
    When the source frame is given, each instance carries its mean color —
    the appearance cue the tracker uses to tell same-group objects apart."""
    h, w = ids.shape
    min_area = min_area_frac * h * w
    max_area = MAX_AREA_FRAC * h * w
    if depth is not None and depth.shape[:2] != (h, w):
        depth = cv2.resize(depth, (w, h), interpolation=cv2.INTER_LINEAR)
    if frame_bgr is not None and frame_bgr.shape[:2] != (h, w):
        frame_bgr = cv2.resize(frame_bgr, (w, h), interpolation=cv2.INTER_AREA)

    by_group: dict[str, list[int]] = {}
    for cls, group in roles["fg"].items():
        by_group.setdefault(group, []).append(cls)

    out: list[dict] = []
    kernel = np.ones((3, 3), np.uint8)
    for group, classes in by_group.items():
        mask = np.isin(ids, classes).astype(np.uint8)
        if not mask.any():
            continue
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for i in range(1, n):
            x, y, bw, bh, area = stats[i]
            if area < min_area or area > max_area:
                continue  # specks are noise; near-full-frame blobs are backdrop
            region = labels[y : y + bh, x : x + bw] == i
            ids_region = ids[y : y + bh, x : x + bw][region]
            cls = int(np.bincount(ids_region, minlength=150).argmax())
            if depth is not None:
                d = float(np.median(depth[y : y + bh, x : x + bw][region])) / 255.0
            else:
                d = 0.5
            box = (
                lock_person_box(float(x), float(y), float(x + bw), float(y + bh), (w, h))
                if group == "person"
                else [int(x), int(y), int(bw), int(bh)]
            )
            color = None
            if frame_bgr is not None:
                # channel-wise median: robust to windows/shadows diluting the body color
                bgr = np.median(frame_bgr[y : y + bh, x : x + bw][region], axis=0)
                color = [int(bgr[2]), int(bgr[1]), int(bgr[0])]  # RGB
            out.append({"group": group, "cls": cls, "box": box, "d": round(d, 3), "color": color})
    return out


# ---------- tracking ----------


def lock_person_box(x0: float, y0: float, x1: float, y1: float, size: tuple[int, int]) -> list[int]:
    """Fixed-aspect person box: height from the detection, width derived,
    centered on the detection's center, clamped to the frame."""
    w, h = size
    bh = y1 - y0
    bw = bh * PERSON_ASPECT
    cx = (x0 + x1) / 2
    nx0 = min(max(0.0, cx - bw / 2), w - 1 - bw)
    return [int(round(nx0)), int(round(max(0.0, y0))), int(round(bw)), int(round(min(bh, h - 1 - y0)))]


def _iou(a: list, b: list) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def track_instances(per_frame: list[list[dict]], size: tuple[int, int]) -> list[dict]:
    """Greedy frame-to-frame matching → stabilized tracks.

    Stabilization rules (segmentation blobs jitter frame to frame):
    - position and size are smoothed separately — size barely breathes and its
      per-frame change is clamped, so blocks don't pump;
    - tracks that barely move overall are STATIC: they collapse to one fixed
      median box (a parked car / building never wobbles), and if seen through
      most of the shot they persist for all of it;
    - short gaps are interpolated; short-lived tracks are dropped as noise."""
    w, h = size
    diag = (w * w + h * h) ** 0.5
    tracks: list[dict] = []
    next_id = 1

    for t, dets in enumerate(per_frame):
        active = [tr for tr in tracks if t - tr["last_seen"] <= TRACK_MAX_GAP]
        used = set()
        for det in dets:
            best, best_score = None, 0.0
            cx, cy = det["box"][0] + det["box"][2] / 2, det["box"][1] + det["box"][3] / 2
            det_color = det.get("color")
            for tr in active:
                if tr["group"] != det["group"] or id(tr) in used:
                    continue
                # appearance gate: identity survives crossings/overlaps because
                # a red jacket won't match a black coat (same-color pairs are a
                # known limitation for now)
                sim = 1.0
                if det_color is not None and tr.get("color") is not None:
                    cdist = float(np.linalg.norm(np.subtract(det_color, tr["color"])))
                    if cdist > COLOR_GATE:
                        continue
                    sim = 1.0 - cdist / COLOR_GATE
                iou = _iou(tr["smooth"], det["box"])
                tx, ty = tr["smooth"][0] + tr["smooth"][2] / 2, tr["smooth"][1] + tr["smooth"][3] / 2
                dist = ((cx - tx) ** 2 + (cy - ty) ** 2) ** 0.5
                score = iou if iou > 0.05 else (0.04 if dist < 0.12 * diag else 0.0)
                if score > 0:
                    score += COLOR_BONUS * sim
                if score > best_score:
                    best, best_score = tr, score
            if best is None:
                best = {
                    "id": next_id,
                    "group": det["group"],
                    "cls": det["cls"],
                    "smooth": list(map(float, det["box"])),
                    "frames": {},
                    "raw": {},
                    "color": list(det_color) if det_color is not None else None,
                    "last_seen": t,
                }
                next_id += 1
                tracks.append(best)
            used.add(id(best))
            if det_color is not None:
                if best.get("color") is None:
                    best["color"] = list(det_color)
                else:
                    best["color"] = [
                        COLOR_EMA * n + (1 - COLOR_EMA) * o for n, o in zip(det_color, best["color"])
                    ]

            nx, ny, nw, nh = map(float, det["box"])
            sx, sy, sw, sh = best["smooth"]
            # size first: slow EMA + hard clamp against pumping
            tw = SIZE_EMA * nw + (1 - SIZE_EMA) * sw
            th = SIZE_EMA * nh + (1 - SIZE_EMA) * sh
            tw = float(np.clip(tw, sw * (1 - SIZE_CLAMP), sw * (1 + SIZE_CLAMP)))
            th = float(np.clip(th, sh * (1 - SIZE_CLAMP), sh * (1 + SIZE_CLAMP)))
            # position: track the detection's center, then re-derive x/y
            ncx, ncy = nx + nw / 2, ny + nh / 2
            scx, scy = sx + sw / 2, sy + sh / 2
            tcx = POS_EMA * ncx + (1 - POS_EMA) * scx
            tcy = POS_EMA * ncy + (1 - POS_EMA) * scy
            best["smooth"] = [tcx - tw / 2, tcy - th / 2, tw, th]
            best["last_seen"] = t
            best["frames"][t] = [*[round(v, 1) for v in best["smooth"]], det["d"]]
            best["raw"][t] = [nx, ny, nw, nh, det["d"]]

    total = len(per_frame)
    keep_min = MIN_TRACK_FRAMES if total >= 6 else 1
    result = []
    for tr in tracks:
        if len(tr["frames"]) < keep_min:
            continue

        # static tracks collapse to one fixed box (median of raw detections)
        raw = np.array([tr["raw"][k] for k in sorted(tr["raw"])], np.float32)
        centers = raw[:, :2] + raw[:, 2:4] / 2
        med_center = np.median(centers, axis=0)
        disp = float(np.max(np.linalg.norm(centers - med_center, axis=1))) if len(raw) > 1 else 0.0
        if disp < STATIC_DISP_FRAC * diag:
            fixed = [*np.median(raw[:, :4], axis=0).round(1).tolist(), float(np.median(raw[:, 4]).round(3))]
            seen = sorted(tr["frames"])
            span = (
                range(total)
                if len(tr["frames"]) >= STATIC_FULL_RANGE * total
                else range(seen[0], seen[-1] + 1)
            )
            tr["frames"] = {t: list(fixed) for t in span}
        elif tr["group"] != "person":
            # moving non-person blocks: segmentation blobs merge/split, so the
            # size is unreliable — freeze it at the track median (a marker box
            # that only translates); people keep their smoothed height instead
            med_w, med_h = float(np.median(raw[:, 2])), float(np.median(raw[:, 3]))
            for t, (x, y, bw, bh, d) in list(tr["frames"].items()):
                cx, cy = x + bw / 2, y + bh / 2
                tr["frames"][t] = [round(cx - med_w / 2, 1), round(cy - med_h / 2, 1),
                                   round(float(med_w), 1), round(float(med_h), 1), d]
            seen = sorted(tr["frames"])
            for a, b in zip(seen, seen[1:]):
                if 1 < b - a <= TRACK_MAX_GAP:
                    va, vb = tr["frames"][a], tr["frames"][b]
                    for m in range(a + 1, b):
                        f = (m - a) / (b - a)
                        tr["frames"][m] = [round(x + (y - x) * f, 1) for x, y in zip(va, vb)]
        else:
            # interpolate short gaps so primitives don't flicker
            seen = sorted(tr["frames"])
            for a, b in zip(seen, seen[1:]):
                if 1 < b - a <= TRACK_MAX_GAP:
                    va, vb = tr["frames"][a], tr["frames"][b]
                    for m in range(a + 1, b):
                        f = (m - a) / (b - a)
                        tr["frames"][m] = [round(x + (y - x) * f, 1) for x, y in zip(va, vb)]

        result.append(
            {"id": tr["id"], "group": tr["group"], "cls": tr["cls"],
             "color": [int(round(c)) for c in tr["color"]] if tr.get("color") else None,
             "frames": {str(k): v for k, v in sorted(tr["frames"].items())}}
        )
    return result


# ---------- person instances from pose keypoints ----------


def persons_from_pose(
    kp_data: dict, size: tuple[int, int], total_frames: int, person_cls: int
) -> list[list[dict]] | None:
    """Per-frame person detections derived from the pose channel's keypoints —
    far more stable than segmentation blobs. Returns None if unusable."""
    frames = kp_data.get("frames")
    if not isinstance(frames, list):
        return None
    w, h = size
    by_frame: dict[int, list] = {f.get("frame", -1): f.get("people", []) for f in frames}

    out: list[list[dict]] = []
    for t in range(total_frames):
        dets: list[dict] = []
        for person in by_frame.get(t, []):
            pts = np.asarray(person.get("keypoints", []), np.float32)
            scores = np.asarray(person.get("scores", []), np.float32)
            if pts.ndim != 2 or len(pts) == 0:
                continue
            n_scores = len(scores)
            valid_idx = [
                i for i in range(len(pts))
                if (scores[i] if i < n_scores else 1.0) > POSE_SCORE_THR
            ]
            if len(valid_idx) < MIN_POSE_POINTS:
                continue

            # anthropometric full-height solve: a partially visible skeleton
            # (legs only, torso only...) still produces the whole-person box
            marks = [
                (float(pts[i][1]), POSE_HEIGHT_FRACTIONS[i])
                for i in valid_idx
                if i in POSE_HEIGHT_FRACTIONS
            ]
            xs = [float(pts[i][0]) for i in valid_idx]
            if not marks or not xs:
                continue
            fracs = sorted({f for _, f in marks})
            if fracs[-1] - fracs[0] >= MIN_FRACTION_SPREAD:
                f_lo, f_hi = fracs[0], fracs[-1]
                y_lo = float(np.mean([y for y, f in marks if f == f_lo]))
                y_hi = float(np.mean([y for y, f in marks if f == f_hi]))
                if y_hi - y_lo < 4:
                    continue
                full_h = (y_hi - y_lo) / (f_hi - f_lo)
                if not (8 <= full_h <= 3 * h):
                    continue
                y0 = y_lo - f_lo * full_h
                y1 = y0 + full_h
            else:
                ys = [y for y, _ in marks]
                y0, y1 = min(ys), max(ys)
                if y1 - y0 < 8:
                    continue
                y0 -= (y1 - y0) * 0.14
                y1 += (y1 - y0) * 0.05
            cx = float(np.median(xs))
            half_w = max(2.0, (y1 - y0) * PERSON_ASPECT / 2)
            box = lock_person_box(cx - half_w, max(0.0, y0), cx + half_w, min(float(h - 1), y1), (w, h))
            if box[3] < 8:
                continue
            dets.append({"group": "person", "cls": person_cls, "box": box, "d": 0.5})
        out.append(dets)
    return out if any(out) else None


# ---------- scene assembly ----------


def build_scene(
    per_frame_instances: list[list[dict]],
    horizons: list[np.ndarray],
    shades: list[list[float]],
    top_counts: np.ndarray,
    bottom_counts: np.ndarray,
    size: tuple[int, int],
    grids: list[dict[str, np.ndarray]] | None = None,
    roles: dict | None = None,
) -> dict:
    # temporal smoothing of the backdrop (strong: the set shouldn't wobble)
    frames = []
    prev = None
    prev_sh = None
    for hz, sh in zip(horizons, shades):
        hz = np.asarray(hz, np.float32)
        sh = np.asarray(sh, np.float32)
        if prev is not None:
            hz = HORIZON_EMA * hz + (1 - HORIZON_EMA) * prev
            sh = SHADE_EMA * sh + (1 - SHADE_EMA) * prev_sh
        prev, prev_sh = hz, sh
        frames.append({"horizon": [int(round(v)) for v in hz], "shade": [round(float(v), 3) for v in sh]})

    top_class = int(top_counts.argmax()) if top_counts.sum() else None
    bottom_class = int(bottom_counts.argmax()) if bottom_counts.sum() else None

    # ground materials: the dominant one is the plane's base color, secondary
    # materials (a lawn beside a road, a pond...) become smoothed patches
    materials = []
    if grids and roles:
        coverage = {
            name: float(np.mean([g[name].mean() for g in grids])) for name in grids[0]
        }
        base = max(coverage, key=coverage.get)
        base_ids = roles["materials"][base]
        if base_ids and bottom_counts[list(base_ids)].sum():
            restricted = np.zeros_like(bottom_counts)
            restricted[list(base_ids)] = bottom_counts[list(base_ids)]
            bottom_class = int(restricted.argmax())
        for name, cover in coverage.items():
            if name == base or cover < MATERIAL_MIN_COVER:
                continue
            id_list = list(roles["materials"][name])
            if not id_list or not bottom_counts[id_list].sum():
                continue
            restricted = np.zeros_like(bottom_counts)
            restricted[id_list] = bottom_counts[id_list]
            materials.append(
                {
                    "name": name,
                    "cls": int(restricted.argmax()),
                    "frames": _material_polys([g[name] for g in grids], size),
                }
            )

    return {
        "version": 3,
        "size": list(size),
        "frame_count": len(frames),
        "top_class": top_class,
        "bottom_class": bottom_class,
        "frames": frames,
        "materials": materials,
        "instances": track_instances(per_frame_instances, size),
    }


# ---------- rendering (mirror: frontend/src/lib/layoutScene.ts) ----------


def _bgr(rgb: list[int]) -> tuple[int, int, int]:
    return int(rgb[2]), int(rgb[1]), int(rgb[0])


def _class_color(meta: dict, cls: int | None, palette: str, fallback_group: str) -> tuple[int, int, int]:
    if palette == "ade":
        rgb = meta["palette"][cls] if cls is not None else [0, 0, 0]
        return _bgr(rgb)
    group = meta["groups"][cls] if cls is not None else fallback_group
    if cls is not None and meta["classes"][cls] == "ceiling":
        group = "building"  # ceiling reads better as structure than props
    return _bgr(meta["blockout_palette"].get(group, meta["blockout_palette"][fallback_group]))


def _fill_round_rect(img: np.ndarray, box: list[float], color, radius_frac: float) -> None:
    x, y, w, h = [int(round(v)) for v in box]
    r = max(1, int(min(w, h) * radius_frac))
    r = min(r, w // 2, h // 2)
    cv2.rectangle(img, (x + r, y), (x + w - r, y + h), color, -1)
    cv2.rectangle(img, (x, y + r), (x + w, y + h - r), color, -1)
    for cx, cy in ((x + r, y + r), (x + w - r, y + r), (x + r, y + h - r), (x + w - r, y + h - r)):
        cv2.circle(img, (cx, cy), r, color, -1)


def _fill_capsule(img: np.ndarray, box: list[float], color) -> None:
    x, y, w, h = [int(round(v)) for v in box]
    r = min(w // 2, h // 2)
    cv2.rectangle(img, (x, y + r), (x + w, y + h - r), color, -1)
    cv2.ellipse(img, (x + w // 2, y + r), (w // 2, r), 0, 180, 360, color, -1)
    cv2.ellipse(img, (x + w // 2, y + h - r), (w // 2, r), 0, 0, 180, color, -1)


def _shade(color: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(int(np.clip(c * factor, 0, 255)) for c in color)


def render_frame(
    scene: dict,
    meta: dict,
    frame_index: int,
    palette: str = "blockout",
    disabled_groups: set[str] | None = None,
    disabled_instances: set[int] | None = None,
    disabled_backdrop: set[str] | None = None,
) -> np.ndarray:
    """Compose backdrop + enabled instance primitives. `palette` is 'ade'
    (exact ControlNet-Seg colors, flat) or 'blockout' (grouped colors, ground
    ramp + depth-shaded primitives).

    `disabled_backdrop` ⊆ {"top", "bottom"}: a disabled plane renders BLACK
    (= unconstrained, left to the model) — backdrop planes are not backfilled;
    only deleted object instances are (by the backdrop behind them)."""
    disabled_groups = disabled_groups or set()
    disabled_instances = disabled_instances or set()
    disabled_backdrop = disabled_backdrop or set()
    w, h = scene["size"]
    fr = scene["frames"][min(frame_index, len(scene["frames"]) - 1)]

    top_color = _class_color(meta, scene["top_class"], palette, "sky")
    bottom_color = _class_color(meta, scene["bottom_class"], palette, "ground")

    horizon = np.interp(np.arange(w), np.linspace(0, w - 1, len(fr["horizon"])), fr["horizon"])
    img = np.zeros((h, w, 3), np.uint8)  # black base = "no guidance"
    row_idx = np.arange(h, dtype=np.float32)[:, None]
    below = row_idx >= horizon[None, :]

    if "top" not in disabled_backdrop:
        img[~below] = top_color
    if "bottom" not in disabled_backdrop:
        f0, f1 = fr["shade"]
        y0 = float(horizon.mean())
        ramp = f0 + (f1 - f0) * np.clip((row_idx - y0) / max(1.0, (h - 1) - y0), 0, 1)
        if palette == "blockout":
            ground = np.clip(
                np.array(bottom_color, np.float32)[None, None, :] * ramp[..., None], 0, 255
            ).astype(np.uint8)
            ground = np.broadcast_to(ground, (h, w, 3))
            img = np.where(below[..., None], ground, img)
        else:
            img[below] = bottom_color

        # secondary ground materials (lawn / water patches) on the plane
        fallback_group = {"veg": "nature", "water": "water", "paved": "ground"}
        for mat in scene.get("materials", []):
            polys = mat["frames"][min(frame_index, len(mat["frames"]) - 1)]
            if not polys:
                continue
            mask = np.zeros((h, w), np.uint8)
            cv2.fillPoly(mask, [np.asarray(p, np.int32) for p in polys], 1)
            sel = (mask > 0) & below
            if not sel.any():
                continue
            m_color = _class_color(meta, mat["cls"], palette, fallback_group.get(mat["name"], "ground"))
            if palette == "blockout":
                patch = np.clip(
                    np.array(m_color, np.float32)[None, None, :] * ramp[..., None], 0, 255
                ).astype(np.uint8)
                patch = np.broadcast_to(patch, (h, w, 3))
                img = np.where(sel[..., None], patch, img)
            else:
                img[sel] = m_color

    # scenery (nature) sits behind everything else; then far → near
    active = []
    for inst in scene["instances"]:
        if inst["id"] in disabled_instances or inst["group"] in disabled_groups:
            continue
        entry = inst["frames"].get(str(frame_index))
        if entry:
            active.append((inst, entry))
    active.sort(key=lambda pair: (pair[0]["group"] != "nature", pair[1][4]))

    img = np.ascontiguousarray(img)
    for inst, (x, y, bw, bh, d) in active:
        color = _class_color(meta, inst["cls"], palette, inst["group"])
        if palette == "blockout":
            color = _shade(color, SHADE_MIN + SHADE_SPAN * float(d))
            border = _shade(color, 0.7)
            box = [x, y, bw, bh]
            if inst["group"] == "person":
                _fill_capsule(img, box, border)
                _fill_capsule(img, [x + 2, y + 2, bw - 4, bh - 4] if bw > 8 and bh > 8 else box, color)
            else:
                rf = {"building": 0.06, "nature": 0.35}.get(inst["group"], 0.15)
                _fill_round_rect(img, box, border, rf)
                if bw > 8 and bh > 8:
                    _fill_round_rect(img, [x + 2, y + 2, bw - 4, bh - 4], color, rf)
        else:
            if inst["group"] == "person":
                _fill_capsule(img, [x, y, bw, bh], color)
            else:
                rf = {"building": 0.06, "nature": 0.35}.get(inst["group"], 0.15)
                _fill_round_rect(img, [x, y, bw, bh], color, rf)
    return img


# ---------- io ----------


def scene_path(shot_dir: Path) -> Path:
    return shot_dir / "layout" / "scene.json"


def load_scene(shot_dir: Path) -> dict | None:
    p = scene_path(shot_dir)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))
