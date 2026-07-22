from app.api.layout import normalize_layout_state


def test_default_state_has_empty_manual_subjects():
    out = normalize_layout_state(None)
    assert out == {"selected_instances": None, "disabled_backdrop": [], "manual_subjects": []}


def test_manual_subject_normalized_and_kept():
    out = normalize_layout_state({
        "manual_subjects": [
            {"id": "m1", "group": "building", "label": "  ancient temple  ",
             "polygon": [[0.1, 0.2], [0.3, 0.2], [0.3, 0.5], [0.1, 0.5]]},
        ]
    })
    m = out["manual_subjects"][0]
    assert m["id"] == "m1"
    assert m["group"] == "building"
    assert m["label"] == "ancient temple"  # trimmed
    assert len(m["polygon"]) == 4


def test_manual_subject_bad_group_defaults_building():
    out = normalize_layout_state({
        "manual_subjects": [
            {"id": "m2", "group": "spaceship", "label": "x",
             "polygon": [[0, 0], [1, 0], [1, 1]]},
        ]
    })
    assert out["manual_subjects"][0]["group"] == "building"


def test_manual_subject_dropped_when_polygon_too_small():
    out = normalize_layout_state({
        "manual_subjects": [
            {"id": "m3", "group": "props", "label": "x", "polygon": [[0.1, 0.1], [0.2, 0.2]]},
        ]
    })
    assert out["manual_subjects"] == []  # <3 points → invalid → dropped


def test_polygon_points_clamped_0_1():
    out = normalize_layout_state({
        "manual_subjects": [
            {"id": "m4", "group": "props", "label": "x",
             "polygon": [[-0.5, 0.5], [1.5, 0.5], [0.5, 2.0]]},
        ]
    })
    for x, y in out["manual_subjects"][0]["polygon"]:
        assert 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0


def test_selected_instances_keeps_int_and_manual_ids():
    out = normalize_layout_state({"selected_instances": [3, "m1", "7", "bad", "m2x"]})
    assert out["selected_instances"] == [3, "m1", 7]  # ints + m\d+ only
