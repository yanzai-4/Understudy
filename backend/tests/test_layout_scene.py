"""Layered scene proxy: instance extraction/tracking, backdrop, hole-free
composition, and instance deletion revealing the backdrop."""
import numpy as np

from app.extractors.layout import load_ade20k
from app.services import layout_scene as ls

META = load_ade20k()
ROLES = ls.scene_roles(META)
PERSON = META["person_index"]
SKY = META["classes"].index("sky")
ROAD = META["classes"].index("road")
CAR = META["classes"].index("car")


def make_ids(w=160, h=120, horizon=60):
    ids = np.full((h, w), SKY, np.uint8)
    ids[horizon:, :] = ROAD
    return ids


# ---------- roles & extraction ----------


def test_roles_split_top_bottom_foreground():
    assert SKY in ROLES["top"]
    assert ROAD in ROLES["bottom"]
    assert ROLES["fg"][PERSON] == "person"
    assert ROLES["fg"][CAR] == "vehicle"
    assert META["classes"].index("ceiling") in ROLES["top"]
    # surface material is backdrop; volumetric vegetation is a scenery object
    assert META["classes"].index("water") in ROLES["bottom"]
    assert META["classes"].index("grass") in ROLES["bottom"]
    assert META["classes"].index("field") in ROLES["bottom"]
    assert ROLES["fg"][META["classes"].index("tree")] == "nature"
    assert ROLES["fg"][META["classes"].index("palm")] == "nature"
    # props are objects
    assert ROLES["fg"][META["classes"].index("signboard")] == "props"


def test_extract_instances_finds_person_and_filters_specks():
    ids = make_ids()
    ids[40:100, 30:50] = PERSON  # 60x20 person = big enough
    ids[10:12, 100:102] = CAR  # 2x2 speck = noise
    insts = ls.extract_instances(ids, None, ROLES)
    groups = [i["group"] for i in insts]
    assert groups == ["person"]
    x, y, w, h = insts[0]["box"]
    assert abs(x - 30) <= 2 and abs(y - 40) <= 2


def test_extract_instances_drops_full_frame_wall():
    wall = META["classes"].index("wall")
    ids = np.full((120, 160), wall, np.uint8)  # a wall filling the whole view
    ids[100:, :] = META["classes"].index("floor")
    insts = ls.extract_instances(ids, None, ROLES)
    assert insts == []  # backdrop-sized blob is not an object


def test_horizon_smooth_and_full_coverage():
    ids = make_ids(horizon=60)
    ids[30:90, 60:90] = CAR  # object straddling the boundary
    hz = ls.estimate_horizon(ids, ROLES)
    assert len(hz) == ls.HORIZON_POINTS
    assert np.all(np.isfinite(hz))
    # boundary continues smoothly through the occluded columns
    assert abs(float(np.median(hz)) - 60) < 12


# ---------- tracking ----------


def _det(x, y=50, w=20, h=40, group="person", cls=PERSON, d=0.5):
    return {"group": group, "cls": cls, "box": [x, y, w, h], "d": d}


def test_tracking_keeps_one_id_for_moving_box():
    frames = [[_det(30 + 4 * t)] for t in range(10)]
    tracks = ls.track_instances(frames, (160, 120))
    assert len(tracks) == 1
    assert len(tracks[0]["frames"]) == 10


def test_tracking_drops_short_lived_noise():
    frames = [[_det(30)] for _ in range(10)]
    frames[4] = [_det(30), _det(120, group="vehicle", cls=CAR)]  # 1-frame flicker
    tracks = ls.track_instances(frames, (160, 120))
    assert [t["group"] for t in tracks] == ["person"]


def test_tracking_interpolates_short_gaps():
    frames = [[_det(30 + 4 * t)] if t not in (4, 5) else [] for t in range(10)]
    tracks = ls.track_instances(frames, (160, 120))
    assert len(tracks) == 1
    assert "4" in tracks[0]["frames"] and "5" in tracks[0]["frames"]


def test_tracking_separates_two_people():
    frames = [[_det(20), _det(120)] for _ in range(8)]
    tracks = ls.track_instances(frames, (160, 120))
    assert len(tracks) == 2


# ---------- scene render ----------


def _scene_with_person():
    ids = make_ids()
    ids[40:100, 60:80] = PERSON
    per_frame = [ls.extract_instances(ids, None, ROLES) for _ in range(4)]
    horizons = [ls.estimate_horizon(ids, ROLES) for _ in range(4)]
    shades = [[0.7, 1.0]] * 4
    counts = np.bincount(ids.ravel(), minlength=150)
    top = np.where(np.isin(np.arange(150), list(ROLES["top"])), counts, 0)
    bottom = np.where(np.isin(np.arange(150), list(ROLES["bottom"])), counts, 0)
    return ls.build_scene(per_frame, horizons, shades, top, bottom, (160, 120))


def test_render_has_no_black_holes():
    scene = _scene_with_person()
    for palette in ("ade", "blockout"):
        img = ls.render_frame(scene, META, 0, palette)
        assert img.shape == (120, 160, 3)
        assert (img.sum(axis=2) == 0).mean() < 0.001  # backdrop always complete


def test_disabled_instance_reveals_backdrop_not_hole():
    scene = _scene_with_person()
    inst = scene["instances"][0]
    x, y, w, h = [int(v) for v in inst["frames"]["0"][:4]]
    cx, cy = x + w // 2, y + h // 2

    with_p = ls.render_frame(scene, META, 0, "ade")
    without = ls.render_frame(scene, META, 0, "ade", disabled_instances={inst["id"]})
    person_rgb = META["palette"][PERSON][::-1]
    assert with_p[cy, cx].tolist() == list(person_rgb)
    assert without[cy, cx].tolist() != list(person_rgb)
    assert without[cy, cx].sum() > 0  # backdrop fill, not black
    # the sample point sits below the horizon → ground color
    assert without[cy, cx].tolist() == list(META["palette"][ROAD][::-1])


def test_disabled_group_removes_all_instances():
    scene = _scene_with_person()
    img = ls.render_frame(scene, META, 0, "blockout", disabled_groups={"person"})
    person_bgr = np.array(META["blockout_palette"]["person"][::-1])
    match = (np.abs(img.astype(int) - person_bgr).sum(axis=2) < 30).mean()
    assert match < 0.001


# ---------- stabilization ----------


def test_static_jittering_box_freezes_solid():
    rng = np.random.RandomState(1)
    frames = [
        [{"group": "vehicle", "cls": CAR,
          "box": [50 + int(rng.randint(-2, 3)), 40 + int(rng.randint(-2, 3)),
                  30 + int(rng.randint(-3, 4)), 20 + int(rng.randint(-3, 4))], "d": 0.5}]
        for _ in range(12)
    ]
    tracks = ls.track_instances(frames, (160, 120))
    assert len(tracks) == 1
    boxes = {tuple(v[:4]) for v in tracks[0]["frames"].values()}
    assert len(boxes) == 1  # frozen: one fixed box for the whole shot
    assert len(tracks[0]["frames"]) == 12  # persists across all frames


def test_moving_nonperson_gets_constant_marker_size():
    rng = np.random.RandomState(3)
    frames = [
        [{"group": "vehicle", "cls": CAR,
          "box": [10 + 8 * t, 40, 60 + int(rng.randint(-20, 21)), 30 + int(rng.randint(-8, 9))], "d": 0.5}]
        for t in range(12)
    ]
    tracks = ls.track_instances(frames, (300, 120))
    sizes = {(v[2], v[3]) for v in tracks[0]["frames"].values()}
    assert len(sizes) == 1  # size frozen at the median; box only translates
    xs = [v[0] for _, v in sorted(tracks[0]["frames"].items(), key=lambda kv: int(kv[0]))]
    assert xs[-1] > xs[0] + 40  # still follows the motion


def test_moving_box_size_does_not_pump():
    rng = np.random.RandomState(2)
    frames = [
        [{"group": "person", "cls": PERSON,
          "box": [20 + 6 * t, 40, 20 + int(rng.randint(-6, 7)), 50 + int(rng.randint(-10, 11))], "d": 0.5}]
        for t in range(12)
    ]
    tracks = ls.track_instances(frames, (300, 120))
    ws = [v[2] for _, v in sorted(tracks[0]["frames"].items(), key=lambda kv: int(kv[0]))]
    rel = [abs(b - a) / a for a, b in zip(ws, ws[1:])]
    assert max(rel) <= ls.SIZE_CLAMP + 1e-6  # clamped, no pumping


# ---------- person aspect lock & pose ----------


def test_person_box_aspect_locked_regardless_of_limb_spread():
    ids = make_ids()
    ids[40:100, 40:60] = PERSON  # narrow pose
    narrow = ls.extract_instances(ids, None, ROLES)[0]["box"]
    ids2 = make_ids()
    ids2[40:100, 30:90] = PERSON  # arms spread wide (3x wider blob)
    wide = ls.extract_instances(ids2, None, ROLES)[0]["box"]
    for box in (narrow, wide):
        assert abs(box[2] / box[3] - ls.PERSON_ASPECT) < 0.05
    assert abs(narrow[2] - wide[2]) <= 1  # same height → same width


def test_persons_from_pose_builds_stable_boxes():
    people = [{
        "keypoints": [[100, 40], [90, 60], [110, 60], [80, 80], [120, 80], [95, 110], [105, 110]],
        "scores": [0.9] * 7,
    }]
    kp = {"format": "openpose_body", "frames": [{"frame": t, "people": people} for t in range(5)]}
    per_frame = ls.persons_from_pose(kp, (200, 150), 5, PERSON)
    assert per_frame is not None and len(per_frame) == 5
    box = per_frame[0][0]["box"]
    assert per_frame[0][0]["group"] == "person"
    assert abs(box[2] / box[3] - ls.PERSON_ASPECT) < 0.06
    # centered near the keypoint centroid x (~100)
    assert abs((box[0] + box[2] / 2) - 100) < 8


def test_legs_only_pose_yields_full_body_box():
    # only hips/knees/ankles visible (indices 8-13); torso+head out of shot
    kpts = [[0, 0]] * 18
    scores = [0.0] * 18
    for i, (x, y) in {8: (95, 100), 11: (105, 100), 9: (95, 160), 12: (105, 160),
                      10: (95, 220), 13: (105, 220)}.items():
        kpts[i] = [x, y]
        scores[i] = 0.9
    kp = {"frames": [{"frame": 0, "people": [{"keypoints": kpts, "scores": scores}]}]}
    per_frame = ls.persons_from_pose(kp, (400, 600), 1, PERSON)
    box = per_frame[0][0]["box"]
    leg_span = 220 - 100  # hips→ankles = 120px ≈ 43% of body height
    # solved full height ≈ 279, head lands above the frame → clipped at y=0
    assert box[3] > leg_span * 1.8  # full body, not leg-sized
    assert box[1] == 0  # clipped at the frame top, like the real person


def test_persons_from_pose_skips_sparse_detections():
    kp = {"frames": [{"frame": 0, "people": [{"keypoints": [[5, 5], [6, 6]], "scores": [0.9, 0.9]}]}]}
    assert ls.persons_from_pose(kp, (200, 150), 1, PERSON) is None


# ---------- salience & selection ----------


def _sal_scene(dets_per_frame, size=(160, 120), frames=8):
    ids = make_ids(size[0], size[1])
    horizons = [ls.estimate_horizon(ids, ROLES) for _ in range(frames)]
    counts = np.bincount(ids.ravel(), minlength=150)
    top = np.where(np.isin(np.arange(150), list(ROLES["top"])), counts, 0)
    bottom = np.where(np.isin(np.arange(150), list(ROLES["bottom"])), counts, 0)
    return ls.build_scene(dets_per_frame, horizons, [[0.7, 1.0]] * frames, top, bottom, size)


def test_salience_prefers_big_near_central_over_tiny_far():
    # a large, near, centred person vs a tiny, far, corner prop
    big = {"group": "person", "cls": PERSON, "box": [60, 40, 30, 60], "d": 0.9, "color": [200, 50, 50]}
    tiny = {"group": "props", "cls": CAR, "box": [2, 2, 8, 8], "d": 0.1, "color": [40, 40, 40]}
    scene = _sal_scene([[dict(big), dict(tiny)] for _ in range(8)])
    by_group = {i["group"]: i for i in scene["instances"]}
    assert by_group["person"]["salience"] > by_group["props"]["salience"]
    assert by_group["person"]["auto"] is True  # the salient subject is proposed


def test_scene_is_v4_minimal_backdrop():
    scene = _sal_scene([[_det(60)] for _ in range(6)])
    assert scene["version"] == 4
    assert "materials" not in scene  # minimal backdrop only
    assert all("salience" in i and "auto" in i for i in scene["instances"])


def test_auto_caps_selection():
    # more candidates than SALIENT_KEEP → only the cap is auto-selected
    dets = [
        {"group": "props", "cls": CAR, "box": [10 * k, 40, 12, 12], "d": 0.5, "color": [k * 10 % 255, 0, 0]}
        for k in range(1, 12)
    ]
    scene = _sal_scene([[dict(d) for d in dets] for _ in range(8)], size=(320, 120))
    autos = [i for i in scene["instances"] if i["auto"]]
    assert len(autos) <= ls.SALIENT_KEEP


def test_hidden_instances_default_shows_all():
    scene = _sal_scene([[_det(60)] for _ in range(6)])
    all_ids = {i["id"] for i in scene["instances"]}
    assert ls.default_selected(scene) == all_ids  # everything shown by default
    assert ls.hidden_instances(scene, None) == set()  # nothing hidden by default
    # curated to an explicit subset → the rest hidden
    keep = next(iter(all_ids))
    assert ls.hidden_instances(scene, [keep]) == all_ids - {keep}


def test_horizon_from_depth_sane_and_clamped():
    h, w = 120, 200
    depth = np.zeros((h, w), np.uint8)
    for y in range(h):
        depth[y, :] = int(255 * y / (h - 1))  # bottom (near) bright → top (far) dark
    hz = ls.horizon_from_depth(depth, [], (w, h))
    assert len(hz) == ls.HORIZON_POINTS
    assert np.all((hz >= h * 0.2 - 1) & (hz <= h * 0.9 + 1))  # clamped to a sane band
    # occluder box + degenerate (all-far) depth don't crash or go crazy
    assert np.all(np.isfinite(ls.horizon_from_depth(depth, [[80, 30, 40, 60]], (w, h))))
    flat = ls.horizon_from_depth(np.zeros((h, w), np.uint8), [], (w, h))
    assert np.all(np.isfinite(flat))
    # no depth at all → a defined flat fallback
    assert len(ls.horizon_from_depth(None, [], (w, h))) == ls.HORIZON_POINTS


def test_horizon_non_linear_and_occlusion_bridged():
    # a sloped sky/ground boundary with a movable occluder standing on it
    h, w = 120, 200
    ids = np.full((h, w), SKY, np.uint8)
    slope = (40 + np.arange(w) * 0.2).astype(int)  # ground rises left→right
    for x in range(w):
        ids[slope[x] :, x] = ROAD
    ids[30:100, 90:120] = PERSON  # occludes the boundary in that band
    hz = ls.estimate_horizon(ids, ROLES)
    assert hz.max() - hz.min() > 8  # non-linear: it followed the slope
    # occluded band bridged from neighbours (no dip toward the person's base)
    xs = np.linspace(0, w - 1, len(hz))
    band = hz[(xs >= 90) & (xs <= 120)]
    assert band.max() < 100  # didn't collapse to the occluder's base


# ---------- color identity ----------


def test_color_gate_keeps_identity_through_crossing():
    red, blue = [220, 40, 40], [40, 60, 220]
    frames = []
    for t in range(10):
        a = {"group": "person", "cls": PERSON, "box": [20 + 12 * t, 40, 20, 50], "d": 0.5, "color": red}
        b = {"group": "person", "cls": PERSON, "box": [128 - 12 * t, 40, 20, 50], "d": 0.5, "color": blue}
        frames.append([a, b])  # they cross around t≈4-5
    tracks = ls.track_instances(frames, (300, 120))
    assert len(tracks) == 2
    by_color = {tuple(tr["color"]): tr for tr in tracks}
    red_track = by_color[tuple(red)]
    xs = [v[0] for _, v in sorted(red_track["frames"].items(), key=lambda kv: int(kv[0]))]
    assert xs[-1] > xs[0] + 60  # red kept moving right through the crossing, no identity swap


def test_color_gate_is_group_agnostic_vehicles_too():
    yellow, black = [230, 200, 40], [30, 30, 35]
    frames = []
    for t in range(10):
        a = {"group": "vehicle", "cls": CAR, "box": [20 + 14 * t, 60, 36, 22], "d": 0.5, "color": yellow}
        b = {"group": "vehicle", "cls": CAR, "box": [160 - 14 * t, 60, 36, 22], "d": 0.5, "color": black}
        frames.append([a, b])
    tracks = ls.track_instances(frames, (340, 120))
    assert len(tracks) == 2
    yellow_track = next(tr for tr in tracks if tr["color"] == yellow)
    xs = [v[0] for _, v in sorted(yellow_track["frames"].items(), key=lambda kv: int(kv[0]))]
    assert xs[-1] > xs[0] + 60  # the yellow car kept its identity through the pass


def test_track_output_carries_color():
    frames = [[{"group": "vehicle", "cls": CAR, "box": [50, 40, 30, 20], "d": 0.5,
                "color": [200, 180, 40]}] for _ in range(6)]
    tracks = ls.track_instances(frames, (160, 120))
    assert tracks[0]["color"] == [200, 180, 40]


# ---------- backdrop toggles ----------


def test_group_repr_cls_matches_asset_group():
    cls = ls.group_repr_cls(META, "building")
    assert cls is not None and META["groups"][cls] == "building"


def _manual(id="m1", group="building", label="temple"):
    # a rectangle polygon covering the left-center of a 160x120 frame
    return {"id": id, "group": group, "label": label,
            "polygon": [[0.1, 0.3], [0.4, 0.3], [0.4, 0.7], [0.1, 0.7]]}


def test_manual_subject_polygon_rendered_in_blockout():
    scene = _scene_with_person()
    img = ls.render_frame(scene, META, 0, "blockout", manual_subjects=[_manual()])
    # a point inside the polygon (0.25*160, 0.5*120) = (40, 60): the depth-shaded
    # building tone (building sits at MANUAL_DEPTH["building"])
    factor = ls.SHADE_MIN + ls.SHADE_SPAN * ls.MANUAL_DEPTH["building"]
    building_bgr = np.array(META["blockout_palette"]["building"][::-1]) * factor
    assert np.abs(img[60, 40].astype(int) - building_bgr).sum() < 6


def test_manual_subject_hidden_when_disabled():
    scene = _scene_with_person()
    shown = ls.render_frame(scene, META, 0, "ade", manual_subjects=[_manual()])
    hidden = ls.render_frame(scene, META, 0, "ade", manual_subjects=[_manual()],
                             disabled_instances={"m1"})
    building_rgb = META["palette"][ls.group_repr_cls(META, "building")][::-1]
    assert shown[60, 40].tolist() == list(building_rgb)
    assert hidden[60, 40].tolist() != list(building_rgb)  # backdrop shows through
    assert hidden[60, 40].sum() > 0  # not a black hole


def test_manual_subject_absent_by_default():
    scene = _scene_with_person()
    img = ls.render_frame(scene, META, 0, "ade")  # no manual_subjects arg
    assert img.shape == (120, 160, 3)  # unchanged signature default


def test_disabled_backdrop_renders_black_not_backfilled():
    scene = _scene_with_person()
    img = ls.render_frame(scene, META, 0, "ade", disabled_backdrop={"top"})
    assert img[5, 5].tolist() == [0, 0, 0]  # sky region black
    assert img[110, 5].tolist() == list(META["palette"][ROAD][::-1])  # ground kept

    img2 = ls.render_frame(scene, META, 0, "blockout", disabled_backdrop={"bottom"})
    assert img2[110, 5].tolist() == [0, 0, 0]  # ground black
    assert img2[5, 5].sum() > 0  # sky kept
    # person instance still drawn on top of a disabled plane
    inst = scene["instances"][0]
    x, y, w, h = [int(v) for v in inst["frames"]["0"][:4]]
    assert img2[y + h // 2, x + w // 2].sum() > 0
