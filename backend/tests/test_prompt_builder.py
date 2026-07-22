from app.services.prompt_builder import compose, layout_labels, load_mappings


def test_layout_labels_dedupes_and_trims():
    subjects = [
        {"id": "m1", "group": "building", "label": " temple ", "polygon": []},
        {"id": "m2", "group": "props", "label": "crowd", "polygon": []},
        {"id": "m3", "group": "building", "label": "temple", "polygon": []},  # dup
        {"id": "m4", "group": "props", "label": "", "polygon": []},  # empty skipped
    ]
    assert layout_labels(subjects) == ["temple", "crowd"]


def test_scene_elements_inserted_after_scene_desc():
    positive, _ = compose(
        {"subject_desc": "a woman", "scene_desc": "a plaza"},
        scene_elements=["a temple", "a crowd"],
    )
    assert positive == "a woman, a plaza, a temple, a crowd"


def test_scene_elements_before_lens_phrases():
    positive, _ = compose(
        {"scene_desc": "a plaza"},
        lens_phrases=["rack focus to the woman"],
        scene_elements=["a fountain"],
    )
    assert positive == "a plaza, a fountain, rack focus to the woman"


def test_scene_elements_empty_is_noop():
    positive, _ = compose({"subject_desc": "hero"}, scene_elements=[])
    assert positive == "hero"


def full_params() -> dict:
    return {
        "shot_size": "medium",
        "camera_angle": "low",
        "aperture": "f2_8",
        "camera_move": "tracking",
        "light_position": "side",
        "light_quality": "hard",
        "light_mood": "neon",
        "time_ambience": "night",
        "weather": "rain",
        "color_grade": "teal_orange",
        "style_suffix": "cinematic",
        "subject_desc": "a young woman in a red trench coat",
        "scene_desc": "narrow neon-lit alley",
        "custom_positive": "steam rising from vents",
        "custom_negative": "cartoon",
    }


def test_full_composition_order():
    positive, negative = compose(full_params())
    assert positive == (
        "a young woman in a red trench coat, narrow neon-lit alley, "
        "medium shot, low angle shot, looking up, "
        "tracking shot, camera following the subject, "
        "f/2.8 aperture, shallow depth of field, soft bokeh, "
        "side lighting, sculpted shadows, "
        "hard light, crisp defined shadows, "
        "neon glow, colorful reflections, "
        "night scene, ambient city glow, "
        "heavy rain, wet reflective surfaces, "
        "teal and orange color grade, "
        "cinematic film still, 35mm film grain, anamorphic, "
        "steam rising from vents"
    )
    assert negative.endswith("cartoon")
    assert "blurry" in negative


def test_lighting_split_dimensions_present():
    mappings = load_mappings()
    keys = {d["key"] for d in mappings["dimensions"]}
    assert {"light_position", "light_quality", "light_mood"} <= keys
    assert "lighting" not in keys


def test_lens_phrases_inserted_after_scene():
    positive, _ = compose(
        {"subject_desc": "a woman", "light_quality": "soft"},
        lens_phrases=["rack focus from the distant background to the woman"],
    )
    assert positive == (
        "a woman, rack focus from the distant background to the woman, "
        "soft diffused light, gentle gradients"
    )


def test_empty_params():
    positive, negative = compose({})
    assert positive == ""
    assert "blurry" in negative and not negative.endswith(", ")


def test_skip_missing_dimensions():
    positive, _ = compose({"light_quality": "soft", "subject_desc": "  "})
    assert positive == "soft diffused light, gentle gradients"


def test_unknown_option_ignored():
    positive, _ = compose({"light_quality": "nonexistent_key"})
    assert positive == ""


def test_whitespace_trimmed():
    positive, _ = compose({"subject_desc": "  hero  ", "custom_positive": " extra "})
    assert positive == "hero, extra"


def test_shutter_dimension_composes():
    positive, _ = compose({"shutter": "fast"})
    assert "fast shutter speed" in positive


def test_shutter_in_mapping_table():
    mappings = load_mappings()
    dims = {d["key"]: d for d in mappings["dimensions"]}
    assert "shutter" in dims
    assert {o["key"] for o in dims["shutter"]["options"]} == {"standard", "fast", "slow", "long"}


def test_mapping_table_wellformed():
    mappings = load_mappings()
    assert mappings["schema_version"] == 2
    assert len(mappings["focal_lengths"]) == 6  # focal moved out of dimensions
    keys = [d["key"] for d in mappings["dimensions"]]
    assert "focal_length" not in keys
    assert len(keys) == len(set(keys)), "duplicate dimension keys"
    for dim in mappings["dimensions"]:
        assert dim["label_zh"] and dim["label_en"]
        option_keys = [o["key"] for o in dim["options"]]
        assert len(option_keys) == len(set(option_keys)), f"dup options in {dim['key']}"
        for opt in dim["options"]:
            assert opt["fragment"].strip(), f"empty fragment {dim['key']}.{opt['key']}"
            assert opt["fragment"] == opt["fragment"].strip()
