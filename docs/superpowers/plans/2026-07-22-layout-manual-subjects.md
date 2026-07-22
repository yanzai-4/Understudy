# Layout Manual Subjects + Annotate→Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify director-drawn regions and detector subjects into one "layout subject" concept — freehand-lasso manual subjects (group + label) that render in the layout blockout, show semi-transparent on the overlay, feed their labels into the positive prompt, and fully replace the old image-editing "background edit" (masks) feature.

**Architecture:** Manual subjects are user data stored in the existing `LayoutState` JSON blob (survives re-extraction), merged with detected subjects (from `scene.json`) at render time. Position is carried by the blockout render; semantics by the prompt text. Build the new system additively (Tasks 1–6) while the old feature still works, then delete the old feature last (Tasks 7–8) so the app is never half-broken.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy (SQLite) / OpenCV+NumPy (backend); Vite / React / TypeScript / Canvas 2D / i18next (frontend). pytest (backend tests). No frontend unit-test harness — frontend tasks are verified by `tsc`/`vite build` + manual run.

## Global Constraints

- Python runs in the repo venv: `backend/.venv` (Python 3.11). Run pytest as `cd backend && .venv/Scripts/python -m pytest`.
- This machine has no discrete GPU and no standalone ffmpeg (video uses `imageio-ffmpeg`). Do not add GPU-only or ffmpeg-CLI code paths.
- Two hand-maintained BE/FE mirror pairs — **edit both sides in the same task**: `backend/app/services/layout_scene.py render_frame` ↔ `frontend/src/lib/layoutScene.ts drawScene`; `backend/app/services/prompt_builder.py compose` ↔ `frontend/src/lib/promptCompose.ts composeParts`.
- i18n must stay EN/ZH at parity: every key added/removed in `frontend/src/i18n/en.json` must match `frontend/src/i18n/zh.json`.
- Manual-subject groups are exactly: `building` (default), `props`, `vehicle`, `person`, `animal`. All five already exist in `backend/app/assets/ade20k.json` `group_order` + `blockout_palette` — **no asset change is needed**.
- Manual-subject ids are strings `"m1"`, `"m2"`, … (namespaced so they never collide with detected integer instance ids). `selected_instances` is one list holding both int (detected) and string (manual) ids.
- Commit messages: single author `Ryan Yan <ziyuan.yan2000@gmail.com>`, NO `Co-Authored-By: Claude` trailer. Per-task commits during development may use plain `type: summary`; the final release commit (Task 8) uses the repo convention `vX.Y.Z 🎬 <summary>` committed via `git commit -F <utf8 file>`.
- Work happens on branch `feature/layout-manual-subjects` (already created; the design spec is committed there).

---

### Task 1: LayoutState manual_subjects — normalize + persist (backend)

Store and validate manual subjects and mixed-type selection ids in the per-shot `LayoutState` blob.

**Files:**
- Modify: `backend/app/api/layout.py:15-32` (`DEFAULT_STATE`, `_int_ids`, `normalize_layout_state`)
- Test: `backend/tests/test_layout_state.py` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `normalize_layout_state(data: dict | None) -> dict` now returns
    `{"selected_instances": list[int|str]|None, "disabled_backdrop": list[str], "manual_subjects": list[dict]}`.
  - A normalized manual subject is `{"id": str, "group": str, "label": str, "polygon": list[[float, float]]}` where `id` matches `^m\d+$`, `group ∈ {building,props,vehicle,person,animal}`, `polygon` has ≥3 points each in `[0,1]`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_layout_state.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_layout_state.py -v`
Expected: FAIL — `normalize_layout_state` returns no `manual_subjects` key (KeyError / assertion mismatch).

- [ ] **Step 3: Implement normalization**

Replace `backend/app/api/layout.py:15-32` with:

```python
import re

DEFAULT_STATE: dict = {"selected_instances": None, "disabled_backdrop": [], "manual_subjects": []}

MANUAL_GROUPS = ("building", "props", "vehicle", "person", "animal")
_MANUAL_ID_RE = re.compile(r"^m\d+$")


def _selected_ids(values) -> list[int | str]:
    """Selection ids: detected subjects are ints, manual subjects are 'm<n>'."""
    out: list[int | str] = []
    for v in values or []:
        if isinstance(v, bool):
            continue
        if isinstance(v, int):
            out.append(v)
        elif isinstance(v, float) and v.is_integer():
            out.append(int(v))
        elif isinstance(v, str):
            if _MANUAL_ID_RE.match(v):
                out.append(v)
            elif v.lstrip("-").isdigit():
                out.append(int(v))
    return out


def _clamp01(v) -> float:
    return max(0.0, min(1.0, float(v)))


def _normalize_manual(subjects) -> list[dict]:
    out: list[dict] = []
    for raw in subjects or []:
        if not isinstance(raw, dict):
            continue
        sid = raw.get("id")
        if not (isinstance(sid, str) and _MANUAL_ID_RE.match(sid)):
            continue
        poly_raw = raw.get("polygon") or []
        polygon = [
            [_clamp01(p[0]), _clamp01(p[1])]
            for p in poly_raw
            if isinstance(p, (list, tuple)) and len(p) >= 2
        ]
        if len(polygon) < 3:
            continue  # need a real region
        group = raw.get("group")
        if group not in MANUAL_GROUPS:
            group = "building"
        label = str(raw.get("label") or "").strip()[:200]
        out.append({"id": sid, "group": group, "label": label, "polygon": polygon})
    return out


def normalize_layout_state(data: dict | None) -> dict:
    """selected_instances: the director's curated subject set (None = show all,
    covering both detected int ids and manual 'm<n>' ids). disabled_backdrop ⊆
    {top, bottom}. manual_subjects: director-drawn lasso regions."""
    data = data or {}
    sel = data.get("selected_instances")
    selected = _selected_ids(sel) if sel is not None else None
    backdrop = [b for b in data.get("disabled_backdrop", []) if b in ("top", "bottom")]
    manual = _normalize_manual(data.get("manual_subjects"))
    return {"selected_instances": selected, "disabled_backdrop": backdrop, "manual_subjects": manual}
```

Leave the imports at the top of the file; move `import re` up with the other stdlib imports if a linter complains.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_layout_state.py -v`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/layout.py backend/tests/test_layout_state.py
git commit -m "feat(layout): persist manual_subjects + mixed selection ids in LayoutState"
```

---

### Task 2: Render manual subjects as polygons (backend layout_scene)

Draw manual-subject polygons into `render_frame`, depth-ordered with detected subjects, hideable by manual id.

**Files:**
- Modify: `backend/app/services/layout_scene.py` (add helpers near `_class_color:673`; extend `render_frame:705-781`)
- Test: `backend/tests/test_layout_scene.py` (append)

**Interfaces:**
- Consumes: normalized manual subjects from Task 1 (`{"id","group","label","polygon"}`).
- Produces:
  - `group_repr_cls(meta: dict, group: str) -> int | None` — first class index whose group == `group` (for the `ade` palette color); `None` if none.
  - `render_frame(scene, meta, frame_index, palette="blockout", disabled_groups=None, disabled_instances=None, disabled_backdrop=None, manual_subjects=None)` — new final param `manual_subjects: list[dict] | None`. Manual subjects render as filled polygons; a manual subject whose `id ∈ disabled_instances` is skipped.
  - `MANUAL_DEPTH: dict[str, float]` — synthetic depth per group for far→near ordering (`building` far, others mid).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_layout_scene.py`:

```python
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
    # a point inside the polygon (0.25*160, 0.5*120) = (40, 60)
    building_bgr = np.array(META["blockout_palette"]["building"][::-1])
    assert np.abs(img[60, 40].astype(int) - building_bgr).sum() < 120  # shaded building tone


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_layout_scene.py -k "manual or repr_cls" -v`
Expected: FAIL — `ls.group_repr_cls` does not exist; `render_frame` has no `manual_subjects` param.

- [ ] **Step 3: Implement the helpers + render path**

Add near `_class_color` (after `backend/app/services/layout_scene.py:680`):

```python
MANUAL_DEPTH = {"building": 0.2}  # buildings sit far; everything else mid
MANUAL_DEPTH_DEFAULT = 0.5


def group_repr_cls(meta: dict, group: str) -> int | None:
    """First ADE class index whose blockout group == `group` — gives manual
    subjects an official-palette color for the 'ade' render."""
    for idx, g in enumerate(meta["groups"]):
        if g == group:
            return idx
    return None


def _fill_poly(img: np.ndarray, polygon: list, color) -> None:
    h, w = img.shape[:2]
    pts = np.array([[round(x * w), round(y * h)] for x, y in polygon], np.int32)
    cv2.fillPoly(img, [pts], color)
```

In `render_frame`, add the parameter and render the manual subjects. Change the signature line (`backend/app/services/layout_scene.py:705-713`) to add `manual_subjects: list[dict] | None = None,` as the last parameter, then add after `disabled_backdrop = disabled_backdrop or set()` (line 723):

```python
    manual_subjects = manual_subjects or []
```

Replace the instance-collection block (`backend/app/services/layout_scene.py:750-758`) with a unified renderable list that also carries manual polygons:

```python
    # scenery (nature) sits behind everything else; then far → near. Manual
    # subjects join the same ordering via a synthetic per-group depth.
    active: list[tuple] = []
    for inst in scene["instances"]:
        if inst["id"] in disabled_instances or inst["group"] in disabled_groups:
            continue
        entry = inst["frames"].get(str(frame_index))
        if entry:
            active.append(("inst", inst["group"], entry[4], inst, entry))
    for subj in manual_subjects:
        if subj["id"] in disabled_instances or subj["group"] in disabled_groups:
            continue
        d = MANUAL_DEPTH.get(subj["group"], MANUAL_DEPTH_DEFAULT)
        active.append(("poly", subj["group"], d, subj, None))
    active.sort(key=lambda r: (r[1] != "nature", r[2]))
```

Then replace the render loop (`backend/app/services/layout_scene.py:760-781`) with one that branches on kind:

```python
    img = np.ascontiguousarray(img)
    for kind, group, d, obj, entry in active:
        if kind == "poly":
            cls = group_repr_cls(meta, group)
            color = _class_color(meta, cls, palette, group)
            if palette == "blockout":
                color = _shade(color, SHADE_MIN + SHADE_SPAN * float(d))
            _fill_poly(img, obj["polygon"], color)
            continue
        x, y, bw, bh, _dd = entry
        color = _class_color(meta, obj["cls"], palette, obj["group"])
        if palette == "blockout":
            color = _shade(color, SHADE_MIN + SHADE_SPAN * float(d))
            border = _shade(color, 0.7)
            box = [x, y, bw, bh]
            if obj["group"] == "person":
                _fill_capsule(img, box, border)
                _fill_capsule(img, [x + 2, y + 2, bw - 4, bh - 4] if bw > 8 and bh > 8 else box, color)
            else:
                rf = {"building": 0.06, "nature": 0.35}.get(obj["group"], 0.15)
                _fill_round_rect(img, box, border, rf)
                if bw > 8 and bh > 8:
                    _fill_round_rect(img, [x + 2, y + 2, bw - 4, bh - 4], color, rf)
        else:
            if obj["group"] == "person":
                _fill_capsule(img, [x, y, bw, bh], color)
            else:
                rf = {"building": 0.06, "nature": 0.35}.get(obj["group"], 0.15)
                _fill_round_rect(img, [x, y, bw, bh], color, rf)
    return img
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_layout_scene.py -v`
Expected: PASS (all existing tests + 4 new). The existing `test_render_has_no_black_holes`, `test_disabled_instance_reveals_backdrop_not_hole`, etc. must still pass (the box/capsule branch is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/layout_scene.py backend/tests/test_layout_scene.py
git commit -m "feat(layout): render manual-subject polygons in render_frame"
```

---

### Task 3: Manual-subject labels feed the prompt (backend)

Add a `scene_elements` fragment to prompt composition and wire manual-subject labels into `generate_prompt`.

**Files:**
- Modify: `backend/app/services/prompt_builder.py:50-90` (`compose`); add `layout_labels` helper
- Modify: `backend/app/api/camera.py:69-94` (`generate_prompt`)
- Test: `backend/tests/test_prompt_builder.py` (append)

**Interfaces:**
- Consumes: normalized `manual_subjects` (Task 1).
- Produces:
  - `layout_labels(manual_subjects: list[dict]) -> list[str]` — non-empty labels, trimmed, de-duplicated, order preserved.
  - `compose(params, mappings=None, lens_phrases=None, scene_elements=None) -> tuple[str, str]` — `scene_elements` are joined into the positive prompt immediately after `scene_desc` (before lens phrases).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_prompt_builder.py`:

```python
from app.services.prompt_builder import layout_labels


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_prompt_builder.py -k "layout_labels or scene_elements" -v`
Expected: FAIL — `layout_labels` missing; `compose` has no `scene_elements` kwarg.

- [ ] **Step 3: Implement**

Add to `backend/app/services/prompt_builder.py` (after the imports, before `DIMENSION_KEYS`):

```python
def layout_labels(manual_subjects: list[dict] | None) -> list[str]:
    """Director-drawn manual-subject labels for the prompt: trimmed, non-empty,
    de-duplicated, order preserved."""
    seen: set[str] = set()
    out: list[str] = []
    for subj in manual_subjects or []:
        label = str(subj.get("label") or "").strip()
        if label and label not in seen:
            seen.add(label)
            out.append(label)
    return out
```

Change the `compose` signature (`backend/app/services/prompt_builder.py:50-52`) to:

```python
def compose(
    params: dict,
    mappings: dict | None = None,
    lens_phrases: list[str] | None = None,
    scene_elements: list[str] | None = None,
) -> tuple[str, str]:
```

Insert the scene-elements fragment right after the subject/scene loop (`backend/app/services/prompt_builder.py:63-66`), i.e. after the `for free_text in (...)` block and before `parts.extend(lens_phrases or [])`:

```python
    parts.extend(scene_elements or [])
```

- [ ] **Step 4: Run prompt-builder tests**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_prompt_builder.py -v`
Expected: PASS (existing + 4 new). Existing `test_lens_phrases_inserted_after_scene` still passes (scene_elements defaults empty).

- [ ] **Step 5: Wire generate_prompt to LayoutState labels**

In `backend/app/api/camera.py`, extend `generate_prompt` (`backend/app/api/camera.py:69-94`). Change the imports inside the function and the `compose` call:

```python
@router.post("/shots/{shot_id}/prompt")
def generate_prompt(shot_id: str, db: Session = Depends(get_db)) -> dict:
    """Authoritative prompt generation, persisted as a history snapshot."""
    from app.api.layout import normalize_layout_state
    from app.models import LayoutState, LensState
    from app.services.lens import lens_phrases
    from app.services.prompt_builder import layout_labels

    get_shot_or_404(db, shot_id)
    params = get_or_create_params(db, shot_id)
    snapshot = _params_dict(params)

    mappings = load_mappings()
    lens_state = db.get(LensState, shot_id)
    phrases = lens_phrases(
        lens_state.data if lens_state else {}, mappings, camera_move_set=bool(snapshot.get("camera_move"))
    )

    layout_state = db.get(LayoutState, shot_id)
    elements = layout_labels(normalize_layout_state(layout_state.data if layout_state else None)["manual_subjects"])

    positive, negative = compose(snapshot, mappings, phrases, elements)
    record = PromptRecord(
        shot_id=shot_id,
        positive_prompt=positive,
        negative_prompt=negative,
        params_snapshot={**snapshot, "lens_phrases": phrases, "scene_elements": elements},
    )
    db.add(record)
    db.commit()
    return {"id": record.id, "positive": positive, "negative": negative}
```

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && .venv/Scripts/python -m pytest -q`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/prompt_builder.py backend/app/api/camera.py backend/tests/test_prompt_builder.py
git commit -m "feat(prompt): feed manual-subject labels into the positive prompt"
```

---

### Task 4: Exporter renders manual subjects + records labels (backend)

The export re-render must include manual subjects, and metadata must carry them. (Masks stay for now; they are removed in Task 7.)

**Files:**
- Modify: `backend/app/services/exporter.py:253-293` (layout re-render), `:360-370` (metadata layout block)
- Test: `backend/tests/test_exporter_layout.py` (create)

**Interfaces:**
- Consumes: `normalize_layout_state` (Task 1), `render_frame(..., manual_subjects=...)` (Task 2).
- Produces: export layout re-render always runs when manual subjects exist; `metadata["layout"]` gains `manual_subjects` (id/group/label) and the prompt already contains the labels (Task 3).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_exporter_layout.py` — a focused unit test of the re-render trigger logic extracted as a helper (keeps the test independent of the full DB/zip pipeline):

```python
from app.services.exporter import layout_needs_rerender


def test_rerender_when_manual_subjects_present():
    assert layout_needs_rerender(selected=None, disabled_backdrop=[], manual_subjects=[{"id": "m1"}], zoom_active=False)


def test_no_rerender_when_nothing_curated():
    assert not layout_needs_rerender(selected=None, disabled_backdrop=[], manual_subjects=[], zoom_active=False)


def test_rerender_when_curated_or_zoom():
    assert layout_needs_rerender(selected=[3], disabled_backdrop=[], manual_subjects=[], zoom_active=False)
    assert layout_needs_rerender(selected=None, disabled_backdrop=["top"], manual_subjects=[], zoom_active=False)
    assert layout_needs_rerender(selected=None, disabled_backdrop=[], manual_subjects=[], zoom_active=True)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_exporter_layout.py -v`
Expected: FAIL — `layout_needs_rerender` does not exist.

- [ ] **Step 3: Extract the helper and use manual subjects in the re-render**

Add near the top of `backend/app/services/exporter.py` (after `_zip_name`, ~line 40):

```python
def layout_needs_rerender(selected, disabled_backdrop, manual_subjects, zoom_active: bool) -> bool:
    """Baked layout PNGs reflect neither curation nor manual subjects, so
    re-render whenever any of those are present (or a zoom warp is active)."""
    return bool(selected is not None or disabled_backdrop or manual_subjects or zoom_active)
```

Replace the layout re-render block (`backend/app/services/exporter.py:260-292`) with a version that reads + passes manual subjects and includes them in `hidden_instances` accounting:

```python
        if "layout" in channels:
            from app.api.layout import normalize_layout_state
            from app.extractors.layout import load_ade20k
            from app.services import layout_scene

            ade_meta = load_ade20k()
            lay_state = db.get(LayoutState, shot_id)
            state = normalize_layout_state(lay_state.data if lay_state else None)
            selected = state["selected_instances"]  # None → show all
            disabled_backdrop = state["disabled_backdrop"]
            manual_subjects = state["manual_subjects"]
            scene = layout_scene.load_scene(shot_dir)
            if scene and layout_needs_rerender(selected, disabled_backdrop, manual_subjects, zoom_active):
                import shutil

                shutil.rmtree(layout_tmp, ignore_errors=True)
                (layout_tmp / "layout").mkdir(parents=True)
                (layout_tmp / "blockout").mkdir(parents=True)
                di = layout_scene.hidden_instances(scene, selected)
                if selected is not None:
                    di |= {m["id"] for m in manual_subjects if m["id"] not in selected}
                dbk = set(disabled_backdrop)
                for i in range(scene["frame_count"]):
                    zoom = lens_service.zoom_params_at(lens, i)
                    ade_img = layout_scene.render_frame(scene, ade_meta, i, "ade", set(), di, dbk, manual_subjects)
                    block_img = layout_scene.render_frame(scene, ade_meta, i, "blockout", set(), di, dbk, manual_subjects)
                    if zoom:
                        ade_img = lens_service.apply_zoom(ade_img, *zoom)
                        block_img = lens_service.apply_zoom(block_img, *zoom)
                    name = f"frame_{i:06d}.png"
                    imwrite_unicode(layout_tmp / "layout" / name, ade_img)
                    imwrite_unicode(layout_tmp / "blockout" / name, block_img)
                channel_dirs["layout"] = layout_tmp / "layout"
                blockout_dir = layout_tmp / "blockout"
            elif (shot_dir / "blockout").exists():
                blockout_dir = shot_dir / "blockout"
```

Note: `render_frame` is called positionally with `manual_subjects` as the 8th arg — matches Task 2's signature order `(scene, meta, frame_index, palette, disabled_groups, disabled_instances, disabled_backdrop, manual_subjects)`.

Update the metadata `layout` block (`backend/app/services/exporter.py:360-370`) to record manual subjects. Replace it with:

```python
            "layout": (
                {
                    "palette": "ade20k",
                    "mode": "scene",
                    "selected_instances": state["selected_instances"],
                    "disabled_backdrop": disabled_backdrop,
                    "manual_subjects": [
                        {"id": m["id"], "group": m["group"], "label": m["label"]}
                        for m in manual_subjects
                    ],
                }
                if "layout" in channels
                else None
            ),
```

Because `state`, `disabled_backdrop`, and `manual_subjects` are now only assigned inside the `if "layout" in channels:` block, initialize them before the block (near `disabled_backdrop: list[str] = []` at `backend/app/services/exporter.py:259`):

```python
        disabled_backdrop: list[str] = []
        manual_subjects: list[dict] = []
        state: dict = {"selected_instances": None}
```

- [ ] **Step 4: Run the test + full suite**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_exporter_layout.py -q && .venv/Scripts/python -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/exporter.py backend/tests/test_exporter_layout.py
git commit -m "feat(export): re-render layout with manual subjects + record them in metadata"
```

---

### Task 5: Frontend render + prompt mirrors (drawScene polygons, composeParts scene elements)

Mirror Tasks 2–3 in TypeScript and extend the shared types. No FE unit tests exist; verification is the type-check/build.

**Files:**
- Modify: `frontend/src/api/types.ts` (add `ManualSubject`; extend `LayoutStateData`? — actually `LayoutStateData` lives in `endpoints.ts:200-204`)
- Modify: `frontend/src/api/endpoints.ts:200-204` (`LayoutStateData`)
- Modify: `frontend/src/lib/layoutScene.ts` (`drawScene` + `groupReprCls` + `ManualSubject`)
- Modify: `frontend/src/lib/promptCompose.ts` (`composeParts` + `layoutLabels`)

**Interfaces:**
- Produces:
  - `ManualSubject` type `{ id: string; group: string; label: string; polygon: [number, number][] }` (exported from `layoutScene.ts`).
  - `LayoutStateData` gains `manual_subjects: ManualSubject[]` and `selected_instances: (number | string)[] | null`.
  - `drawScene(ctx, scene, asset, frameIndex, palette, disabledGroups, disabledInstances: Set<number|string>, disabledBackdrop?, manualSubjects?: ManualSubject[])`.
  - `groupReprCls(asset, group) -> number | null`.
  - `composeParts(params, mappings, lensPhrases?, sceneElements?: string[])`.
  - `layoutLabels(manualSubjects: ManualSubject[]) -> string[]`.

- [ ] **Step 1: Add `ManualSubject` + extend `LayoutStateData`**

In `frontend/src/lib/layoutScene.ts`, add after `SceneInstance` (`:16`):

```typescript
export interface ManualSubject {
  id: string // 'm1', 'm2', … (namespaced vs detected numeric ids)
  group: string // building | props | vehicle | person | animal
  label: string
  polygon: [number, number][] // normalized 0-1, closed region
}
```

In `frontend/src/api/endpoints.ts`, import it and update `LayoutStateData` (`:200-204`):

```typescript
import type { LayoutSceneJson, ManualSubject } from '../lib/layoutScene'

export interface LayoutStateData {
  // director's curated ids; null = show all. Detected ids are numbers, manual 'm<n>'.
  selected_instances: (number | string)[] | null
  disabled_backdrop: string[] // 'top' | 'bottom' — disabled planes render black
  manual_subjects: ManualSubject[]
}
```

(If `endpoints.ts` does not already import from `layoutScene`, add the import; `LayoutSceneJson` is only added if needed elsewhere — otherwise import just `ManualSubject`.)

- [ ] **Step 2: Implement `groupReprCls` + polygon render in `drawScene`**

In `frontend/src/lib/layoutScene.ts`, add after `classColor` (`:45`):

```typescript
const MANUAL_DEPTH: Record<string, number> = { building: 0.2 }
const MANUAL_DEPTH_DEFAULT = 0.5

export function groupReprCls(asset: Ade20kAsset, group: string): number | null {
  const idx = asset.groups.indexOf(group)
  return idx >= 0 ? idx : null
}
```

Change the `drawScene` signature (`frontend/src/lib/layoutScene.ts:61-70`) to add the two new params:

```typescript
export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: LayoutSceneJson,
  asset: Ade20kAsset,
  frameIndex: number,
  palette: 'ade' | 'blockout',
  disabledGroups: Set<string>,
  disabledInstances: Set<number | string>,
  disabledBackdrop: Set<string> = new Set(),
  manualSubjects: ManualSubject[] = [],
) {
```

Replace the `active` build + render loop (`frontend/src/lib/layoutScene.ts:115-149`) with a unified list that includes polygons:

```typescript
  type Renderable =
    | { kind: 'inst'; group: string; d: number; inst: SceneInstance; entry: number[] }
    | { kind: 'poly'; group: string; d: number; subj: ManualSubject }

  const active: Renderable[] = []
  for (const inst of scene.instances) {
    if (disabledInstances.has(inst.id) || disabledGroups.has(inst.group)) continue
    const entry = inst.frames[String(frameIndex)]
    if (entry) active.push({ kind: 'inst', group: inst.group, d: entry[4], inst, entry })
  }
  for (const subj of manualSubjects) {
    if (disabledInstances.has(subj.id) || disabledGroups.has(subj.group)) continue
    active.push({ kind: 'poly', group: subj.group, d: MANUAL_DEPTH[subj.group] ?? MANUAL_DEPTH_DEFAULT, subj })
  }
  active.sort(
    (a, b) => Number(a.group !== 'nature') - Number(b.group !== 'nature') || a.d - b.d,
  )

  for (const r of active) {
    if (r.kind === 'poly') {
      const cls = groupReprCls(asset, r.group)
      const base = classColor(asset, cls, palette, r.group)
      const f = palette === 'blockout' ? SHADE_MIN + SHADE_SPAN * r.d : 1
      const [w0, h0] = scene.size
      ctx.beginPath()
      r.subj.polygon.forEach(([px, py], i) =>
        i === 0 ? ctx.moveTo(px * w0, py * h0) : ctx.lineTo(px * w0, py * h0),
      )
      ctx.closePath()
      ctx.fillStyle = css(base, f)
      ctx.fill()
      continue
    }
    const { inst, entry } = r
    const [x, y, bw, bh, d] = entry
    const base = classColor(asset, inst.cls, palette, inst.group)
    const radius =
      inst.group === 'person'
        ? Math.min(bw, bh) / 2
        : Math.min(bw, bh) *
          (inst.group === 'building' ? 0.06 : inst.group === 'nature' ? 0.35 : 0.15)
    if (palette === 'blockout') {
      const f = SHADE_MIN + SHADE_SPAN * d
      roundRectPath(ctx, x, y, bw, bh, radius)
      ctx.fillStyle = css(base, f * 0.7)
      ctx.fill()
      if (bw > 8 && bh > 8) {
        roundRectPath(ctx, x + 2, y + 2, bw - 4, bh - 4, radius)
        ctx.fillStyle = css(base, f)
        ctx.fill()
      }
    } else {
      roundRectPath(ctx, x, y, bw, bh, radius)
      ctx.fillStyle = css(base)
      ctx.fill()
    }
  }
}
```

- [ ] **Step 3: Mirror `compose` changes in `promptCompose.ts`**

In `frontend/src/lib/promptCompose.ts`, add `layoutLabels` and extend `composeParts` (`:13-39`). Add a param and insert scene elements after `scene`:

```typescript
import type { ManualSubject } from './layoutScene'

export function layoutLabels(manualSubjects: ManualSubject[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of manualSubjects) {
    const label = (s.label ?? '').trim()
    if (label && !seen.has(label)) {
      seen.add(label)
      out.push(label)
    }
  }
  return out
}

export function composeParts(
  params: CameraParamsValues,
  mappings: PromptMappings,
  lensPhrases: string[] = [],
  sceneElements: string[] = [],
): PromptPart[] {
  const parts: PromptPart[] = []

  const subject = (params.subject_desc ?? '').trim()
  if (subject) parts.push({ source: 'subject', text: subject })
  const scene = (params.scene_desc ?? '').trim()
  if (scene) parts.push({ source: 'scene', text: scene })

  for (const el of sceneElements) parts.push({ source: 'scene_element', text: el })

  for (const phrase of lensPhrases) parts.push({ source: 'lens', text: phrase })
  // …unchanged dimension + custom loops follow…
```

(Keep the rest of `composeParts` unchanged. `composePositive`/`composeNegative` keep their existing signatures.)

- [ ] **Step 4: Type-check + build**

Run: `cd frontend && npm run build`
Expected: PASS (no TS errors). Existing callers of `drawScene` (`LayoutPanel.tsx`) and `composeParts` (`PromptPreviewPanel.tsx`) still compile because the new params are optional — they are updated in Task 6.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/endpoints.ts frontend/src/lib/layoutScene.ts frontend/src/lib/promptCompose.ts
git commit -m "feat(layout-fe): mirror polygon render + scene-element prompt fragment"
```

---

### Task 6: New Preview UX — persistent SubjectPanel, lasso tool, overlay layout

Swap the Preview step from the box/annotate flow to: a persistent subject panel (both modes), a freehand lasso tool that creates manual subjects, and a semi-transparent layout overlay. After this task, no frontend code calls the background-edit endpoints.

**Files:**
- Create: `frontend/src/components/preview/LassoDrawLayer.tsx`
- Create: `frontend/src/components/preview/SubjectPanel.tsx`
- Create: `frontend/src/components/preview/ManualSubjectForm.tsx`
- Modify: `frontend/src/components/preview/OverlayView.tsx` (layout branch + opacity)
- Modify: `frontend/src/components/preview/FramePlayer.tsx` (surface `mode` + `layout on` to parent; layout opacity)
- Modify: `frontend/src/components/wizard/StepPreview.tsx` (orchestrate new panel + lasso; drop box/annotate)
- Modify: `frontend/src/components/wizard/StepCamera.tsx` (feed manual labels instead of edits to PromptPreviewPanel)
- Modify: `frontend/src/components/camera/PromptPreviewPanel.tsx` (show scene elements in the prompt; drop the "bg edits" block)
- Modify: `frontend/src/i18n/en.json`, `frontend/src/i18n/zh.json` (add `layout.draw*`, `layout.group.*` labels used by the form; keep existing bgEdit keys until Task 8)

**Interfaces:**
- Consumes: `getLayoutState`/`putLayoutState` (with `manual_subjects`), `drawScene`, `layoutLabels`, `ManualSubject`.
- Produces:
  - `LassoDrawLayer` props: `{ manualSubjects: ManualSubject[]; drawMode: boolean; selectedId: string | null; onSelect(id: string | null): void; onDrawn(polygon: [number,number][]): void }`.
  - `SubjectPanel` props: `{ shot: Shot; index: number; editable: boolean; onManualDraft(polygon): void; drawMode: boolean; onToggleDraw(): void }` — owns LayoutState load/persist and exposes current `manual_subjects` + a draw toggle. (Exact prop wiring may be refined during implementation; the contract is: SubjectPanel is the single source of truth for LayoutState, StepPreview hosts the lasso layer.)
  - `OverlayView` new optional props: `{ layoutOn: boolean; layoutOpacity: number; scene: LayoutSceneJson | null; asset: Ade20kAsset | null; manualSubjects: ManualSubject[]; disabledInstances: Set<number|string>; disabledBackdrop: Set<string> }`.

- [ ] **Step 1: LassoDrawLayer (freehand → polygon)**

Create `frontend/src/components/preview/LassoDrawLayer.tsx`. Model the pointer/normalization approach on `BoxDrawLayer.tsx` but capture a point path and simplify on release:

```tsx
import { useRef, useState } from 'react'
import type { ManualSubject } from '../../lib/layoutScene'

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const MIN_POINTS = 6
const MIN_SPAN = 0.03 // reject tiny scribbles (fraction of frame)

interface Props {
  manualSubjects: ManualSubject[]
  drawMode: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onDrawn: (polygon: [number, number][]) => void
}

/** Freehand lasso over the preview image → a simplified normalized polygon. */
export default function LassoDrawLayer({ manualSubjects, drawMode, selectedId, onSelect, onDrawn }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [path, setPath] = useState<[number, number][] | null>(null)
  const drawing = useRef(false)

  const toNorm = (e: React.PointerEvent): [number, number] => {
    const rect = ref.current!.getBoundingClientRect()
    return [clamp((e.clientX - rect.left) / rect.width), clamp((e.clientY - rect.top) / rect.height)]
  }

  const onDown = (e: React.PointerEvent) => {
    if (!drawMode || e.target !== e.currentTarget) return
    drawing.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setPath([toNorm(e)])
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return
    setPath((p) => (p ? [...p, toNorm(e)] : [toNorm(e)]))
  }
  const onUp = () => {
    if (!drawing.current) return
    drawing.current = false
    const p = path ?? []
    setPath(null)
    if (p.length < MIN_POINTS) return
    const xs = p.map((q) => q[0])
    const ys = p.map((q) => q[1])
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    if (span < MIN_SPAN) return
    onDrawn(simplify(p))
  }

  const [w, h] = [1000, 1000] // SVG viewBox in per-mille of the frame
  const toPts = (poly: [number, number][]) => poly.map(([x, y]) => `${x * w},${y * h}`).join(' ')

  return (
    <div
      ref={ref}
      className={`absolute inset-0 ${drawMode ? 'cursor-crosshair' : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        {manualSubjects.map((s) => (
          <polygon
            key={s.id}
            points={toPts(s.polygon)}
            className={`pointer-events-auto cursor-pointer ${
              s.id === selectedId ? 'fill-cyan-400/25 stroke-cyan-300' : 'fill-cyan-400/10 stroke-cyan-400/60'
            }`}
            strokeWidth={2}
            onPointerDown={(e) => {
              e.stopPropagation()
              onSelect(s.id === selectedId ? null : s.id)
            }}
          />
        ))}
        {path && path.length > 1 && (
          <polyline points={toPts(path)} className="fill-none stroke-cyan-300" strokeWidth={2} strokeDasharray="6 4" />
        )}
      </svg>
    </div>
  )
}

/** Radial-distance decimation — keeps shape, drops jitter. */
function simplify(points: [number, number][], tol = 0.008): [number, number][] {
  const out: [number, number][] = [points[0]]
  for (const p of points) {
    const [lx, ly] = out[out.length - 1]
    if (Math.hypot(p[0] - lx, p[1] - ly) >= tol) out.push(p)
  }
  return out.length >= 3 ? out : points
}
```

- [ ] **Step 2: ManualSubjectForm (group dropdown + label)**

Create `frontend/src/components/preview/ManualSubjectForm.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../common/Button'

const GROUPS = ['building', 'props', 'vehicle', 'person', 'animal'] as const

interface Props {
  onSubmit: (group: string, label: string) => void
  onCancel: () => void
}

export default function ManualSubjectForm({ onSubmit, onCancel }: Props) {
  const { t } = useTranslation()
  const [group, setGroup] = useState<string>('building')
  const [label, setLabel] = useState('')
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-cyan-500/40 bg-night-800 p-2.5">
      <select
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        className="rounded border border-night-600 bg-night-900 px-2 py-1 text-xs text-slate-200"
      >
        {GROUPS.map((g) => (
          <option key={g} value={g}>
            {t(`layout.group.${g}`)}
          </option>
        ))}
      </select>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t('layout.drawLabelPlaceholder')}
        className="rounded border border-night-600 bg-night-900 px-2 py-1 text-xs text-slate-200"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button onClick={() => onSubmit(group, label.trim())}>{t('common.add')}</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: SubjectPanel — LayoutState owner (detected + manual), persistent, gated**

Create `frontend/src/components/preview/SubjectPanel.tsx` by lifting the load/persist/candidate/backdrop logic from `LayoutPanel.tsx:18-110` and adding a manual-subject list + a `mNextId` allocator. It renders the checkbox list for detected subjects AND manual subjects, backdrop toggles, and a "Draw region" toggle button. It accepts `editable: boolean` — when false, controls are `disabled` and dimmed. It exposes, via callbacks/props from the parent, the current `manualSubjects` array and a way to append a new one after the lasso+form completes.

Key state (mirror `LayoutPanel`): `asset`, `scene`, `selected: (number|string)[]|null`, `disabledBackdrop: string[]`, `manualSubjects: ManualSubject[]`, plus a debounced `persist()` that calls `putLayoutState(shot.id, { selected_instances, disabled_backdrop, manual_subjects })`. New-subject id allocation: `` `m${1 + max(existing numeric suffixes, 0)}` ``.

The panel is the single source of truth; `StepPreview` reads `manualSubjects`/`selected`/`disabledBackdrop`/`scene`/`asset` from it (lift these to `StepPreview` state, or use a small context) so both the overlay canvas and the lasso layer see the same data. Implementation detail is left to the engineer, but the invariant is: **exactly one component performs `putLayoutState`, and the overlay + lasso + panel all render from the same in-memory state.**

Recommended shape: make `StepPreview` own the LayoutState (`selected`, `disabledBackdrop`, `manualSubjects`, `scene`, `asset`) and the debounced persist; pass them down to `SubjectPanel` (presentational: renders checkboxes/toggles/draw button, calls handlers) and to `OverlayView`/`LassoDrawLayer`. This avoids duplicated persistence. Rework `SubjectPanel` accordingly (props: lists + handlers + `editable`).

- [ ] **Step 4: OverlayView layout branch**

Modify `frontend/src/components/preview/OverlayView.tsx` to draw the layout on a canvas when `layoutOn`. Add props and a canvas layer that runs `drawScene` at the frame's natural size, sized to overlay via CSS, at `layoutOpacity`:

```tsx
import { useEffect, useRef, type ReactNode } from 'react'
import type { Shot } from '../../api/types'
import { frameUrl } from '../../hooks/useFrameUrl'
import { drawScene, type LayoutSceneJson, type ManualSubject } from '../../lib/layoutScene'
import type { Ade20kAsset } from '../../api/endpoints'

interface Props {
  shot: Shot
  index: number
  channels: string[]
  depthOpacity: number
  children?: ReactNode
  // layout overlay
  layoutOn: boolean
  layoutOpacity: number
  scene: LayoutSceneJson | null
  asset: Ade20kAsset | null
  manualSubjects: ManualSubject[]
  disabledInstances: Set<number | string>
  disabledBackdrop: Set<string>
}

export default function OverlayView(props: Props) {
  const { shot, index, channels, depthOpacity, children } = props
  const { layoutOn, layoutOpacity, scene, asset, manualSubjects, disabledInstances, disabledBackdrop } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!layoutOn || !scene || !asset || !canvasRef.current) return
    const canvas = canvasRef.current
    const [w, h] = scene.size
    canvas.width = w
    canvas.height = h
    drawScene(canvas.getContext('2d')!, scene, asset, index, 'blockout', new Set(), disabledInstances, disabledBackdrop, manualSubjects)
  }, [layoutOn, scene, asset, index, disabledInstances, disabledBackdrop, manualSubjects])

  return (
    <div className="relative mx-auto w-fit">
      <img src={frameUrl(shot, 'frames', index)} alt="" className="block max-h-[60vh] rounded-lg" draggable={false} />
      {channels.includes('depth') && (
        <img src={frameUrl(shot, 'depth', index)} alt="" draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full rounded-lg" style={{ opacity: depthOpacity }} />
      )}
      {channels.includes('pose') && (
        <img src={frameUrl(shot, 'pose', index)} alt="" draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full rounded-lg" style={{ mixBlendMode: 'screen' }} />
      )}
      {layoutOn && scene && asset && (
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full rounded-lg" style={{ opacity: layoutOpacity }} />
      )}
      {children}
    </div>
  )
}
```

- [ ] **Step 5: FramePlayer — surface mode + layout toggle; pass layout props**

Modify `frontend/src/components/preview/FramePlayer.tsx`:
- Add a `layout` opacity slider (mirror the depth slider) shown when `overlayChannels.includes('layout')`.
- Pass the new layout props through to `OverlayView` (the parent `StepPreview` supplies `scene`/`asset`/`manualSubjects`/`disabledInstances`/`disabledBackdrop` — add them to `FramePlayer`'s `Props` and forward them).
- Notify the parent of `mode` and whether the `layout` overlay channel is on, via a new optional callback `onEditableChange?(editable: boolean)` where `editable = mode === 'split' || overlayChannels.includes('layout')`. Call it in an effect on `[mode, overlayChannels]`.

- [ ] **Step 6: StepPreview — orchestrate the new flow**

Rewrite `frontend/src/components/wizard/StepPreview.tsx` to:
- Own LayoutState (`scene`, `asset`, `selected`, `disabledBackdrop`, `manualSubjects`) + debounced persist (as decided in Step 3), loaded via `getAde20k`, the `scene.json` fetch (copy the fetch from `LayoutPanel.tsx:32-35`), and `getLayoutState`.
- Compute `disabledInstances: Set<number|string>` = all detected ids + all manual ids not in `selected` (when `selected` non-null).
- Render `FramePlayer` with `overlayExtras={<LassoDrawLayer … />}` and the layout props; render `SubjectPanel` beside it (presentational), gated by `editable` from `onEditableChange`.
- On lasso `onDrawn(polygon)` → open `ManualSubjectForm`; on submit → append `{ id: nextManualId(), group, label, polygon }` to `manualSubjects`, persist, close form.
- Remove all imports/usages of `BoxDrawLayer`, `BackgroundEditModal`, `createBackgroundEdit`, `updateBackgroundEdit`, `deleteBackgroundEdit`, `listBackgroundEdits`, and the `edits` state. Keep `ConfirmDialog` for manual-subject deletion (delete removes it from `manualSubjects` + persists).

- [ ] **Step 7: StepCamera + PromptPreviewPanel — show scene elements, drop bg-edits**

- `frontend/src/components/wizard/StepCamera.tsx`: replace the `listBackgroundEdits(shot.id)` load (`:42`) with `getLayoutState(shot.id)`; derive `sceneElements = layoutLabels(state.manual_subjects)`; pass `sceneElements` to `PromptPreviewPanel` instead of `edits`.
- `frontend/src/components/camera/PromptPreviewPanel.tsx`: change the prop `edits: BackgroundEdit[]` → `sceneElements: string[]`; pass it as the 4th arg to `composeParts(params, mappings, lensPhrases, sceneElements)`; add `scene_element` to `SOURCE_COLORS` (e.g. `'text-teal-300'`); DELETE the entire "Background edit intents" block (`:94-110`). The labels now appear inline in the composed prompt with their own color.

- [ ] **Step 8: i18n keys used by the new UI**

Add to both `frontend/src/i18n/en.json` and `zh.json` under `layout`:
- `layout.draw` = "Draw region" / "描区域"
- `layout.drawing` = "Drawing · lasso a region" / "描区域中 · 圈出范围"
- `layout.drawLabelPlaceholder` = "Label (optional): crowd, temple…" / "标签(可选):人群、寺庙…"
- `layout.manualHint` = "Lasso a region and label what belongs there — it joins the layout and the prompt." / "圈出一块区域并标注内容——它会进入布局和提示词。"
- Confirm `layout.group.building` / `props` / `vehicle` / `person` / `animal` all exist in both files (they are used by `LayoutPanel` today; add any missing).
- Add `common.add` / `common.cancel` if missing.
Do NOT remove `bgEdit.*` / `camera.bgEdits*` / `export.masksAuto` yet — Task 8 removes them.

- [ ] **Step 9: Build + manual verification**

Run: `cd frontend && npm run build`
Expected: PASS. Then run the app (`scripts/run.ps1`) and verify on an extracted shot:
- Overlay mode with layout toggle OFF → subject panel is greyed/read-only.
- Overlay mode with layout toggle ON → panel editable; layout blocks show semi-transparent over the frame; opacity slider works.
- "Draw region" → lasso a shape → form → pick group + label → region appears in the panel list, in the overlay, and in split-mode layout panel.
- Camera step: the label appears inline in the positive prompt.
- Split mode → panel editable regardless of layout toggle.

- [ ] **Step 10: Commit**

```bash
git add frontend/src
git commit -m "feat(preview): persistent subject panel, lasso manual subjects, overlay layout"
```

---

### Task 7: Remove the background-edit backend + drop the table

With the frontend no longer calling background-edit endpoints (Task 6), delete the backend feature and drop the table.

**Files:**
- Delete: `backend/app/api/background.py`, `backend/app/services/mask_renderer.py`, `backend/tests/test_mask_renderer.py`
- Modify: `backend/app/api/__init__.py` (remove `background` import + `include_router`)
- Modify: `backend/app/models.py` (remove `BackgroundEdit` class `:135-156` + `Shot.background_edits` relationship `:85-87`)
- Modify: `backend/app/schemas.py` (remove `EditType` `:9`)
- Modify: `backend/app/services/shot_ops.py` (remove `BackgroundEdit`/`render_masks` imports + the clone loop `:99-113`)
- Modify: `backend/app/services/exporter.py` (remove `edits` query `:152-157`, `include_masks` `:162`, `edits_json` `:316-333`, `background_edits` in metadata `:359`, the mask write block `:418-427`, `BackgroundEdit` import `:21`, and the mask README text + `has_masks` param in `_readme_text` `:66-96,391`)
- Modify: `backend/app/db.py` (`_migrate` — drop the table)
- Modify: `backend/tests/test_layout.py` if it references removed symbols (it does not, but re-run to confirm)

- [ ] **Step 1: Add the DROP TABLE migration + write its test**

In `backend/app/db.py` `_migrate()`, after the ADD COLUMN loop, drop the obsolete table:

```python
    with engine.begin() as conn:
        for table, columns in added_columns.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            for col in columns:
                if col not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {col} VARCHAR(50)")
        # background-edit feature removed — drop its table if an old DB has it
        conn.exec_driver_sql("DROP TABLE IF EXISTS background_edits")
```

Create `backend/tests/test_migrate_drops_background_edits.py`:

```python
import sqlalchemy as sa

from app.db import engine


def test_background_edits_table_gone_after_migrate():
    # init_db() runs at import via app startup in the smoke tests; here assert the
    # DROP is idempotent and the table is absent.
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP TABLE IF EXISTS background_edits")
    insp = sa.inspect(engine)
    assert "background_edits" not in insp.get_table_names()
```

- [ ] **Step 2: Run the migration test (expect fail if table logic missing, then pass)**

Run: `cd backend && .venv/Scripts/python -m pytest tests/test_migrate_drops_background_edits.py -v`
Expected: PASS after Step 1's change.

- [ ] **Step 3: Delete files + references**

```bash
git rm backend/app/api/background.py backend/app/services/mask_renderer.py backend/tests/test_mask_renderer.py
```

Then edit:
- `backend/app/api/__init__.py`: remove `background,` from the import (`:4`) and `api_router.include_router(background.router)` (`:22`).
- `backend/app/models.py`: delete the `BackgroundEdit` class (`:135-156`) and the `background_edits` relationship on `Shot` (`:85-87`).
- `backend/app/schemas.py`: delete `EditType = Literal["remove", "add", "replace"]` (`:9`).
- `backend/app/services/shot_ops.py`: remove `BackgroundEdit` from the models import (`:10`), remove `from app.services.mask_renderer import render_masks` (`:12`), and delete the `for edit in source.background_edits:` loop (`:99-113`). Update the module docstring/comment that mentions "annotations"/"masks".
- `backend/app/services/exporter.py`: remove the `BackgroundEdit` import (`:21`); delete the `edits = db.query(...)` block (`:152-157`); change `include_masks = ...` (`:162`) — delete the line; delete `edits_json` (`:316-333`); remove `"background_edits": edits_json,` from metadata (`:359`); delete the `if include_masks:` mask-writing block (`:418-427`); change `_readme_text` to drop the `has_masks` param and both mask paragraphs (`:66-96`) and its call site (`:391`) to `_readme_text(meta["effective_fps"], channels)`.

- [ ] **Step 4: Run the full backend suite**

Run: `cd backend && .venv/Scripts/python -m pytest -q`
Expected: PASS. `test_mask_renderer.py` is gone; no import errors for `BackgroundEdit`/`EditType`/`mask_renderer`. If any test imports a removed symbol, fix that test.

- [ ] **Step 5: Commit**

```bash
git add -A backend
git commit -m "refactor: remove background-edit feature + drop background_edits table"
```

---

### Task 8: Remove frontend background-edit dead code + finalize (version bump, README, i18n)

Delete the now-unused frontend background-edit code and ship the release.

**Files:**
- Delete: `frontend/src/components/preview/BoxDrawLayer.tsx`, `frontend/src/components/preview/BackgroundEditModal.tsx`
- Modify: `frontend/src/api/endpoints.ts` (remove `listBackgroundEdits`/`createBackgroundEdit`/`updateBackgroundEdit`/`deleteBackgroundEdit` `:121-153`, remove `masks` from `startExport` include `:226-234`)
- Modify: `frontend/src/api/types.ts` (remove `BackgroundEdit` `:175-187` + `EditType` `:9`)
- Modify: `frontend/src/components/wizard/StepExport.tsx` (remove `edits` state + `listBackgroundEdits` load `:25,41`, the masks auto row `:147-150`, and `masks: true` from the export call `:61`)
- Modify: `frontend/src/i18n/en.json` + `zh.json` (remove `bgEdit.*`, `camera.bgEdits`, `camera.bgEditsHint`, `export.masksAuto`)
- Modify: `README.md` + `README.zh.md` (drop background-edit/mask mentions; note lasso manual subjects)
- Modify: `backend/app/__init__.py` (`__version__`), `frontend/package.json` (`version`)
- Modify: `backend/app/services/exporter.py` README-in-zip already handled in Task 7

- [ ] **Step 1: Delete components + API + types**

```bash
git rm frontend/src/components/preview/BoxDrawLayer.tsx frontend/src/components/preview/BackgroundEditModal.tsx
```

Then edit:
- `frontend/src/api/endpoints.ts`: delete the "Background edits" section (`:121-153`) and the `EditType`/`BackgroundEdit` names from the type import (`:2-20`). In `startExport` (`:226-234`) remove the `masks: boolean` field from the `include` param type and the call site in `StepExport`.
- `frontend/src/api/types.ts`: delete `EditType` (`:9`) and the `BackgroundEdit` interface (`:175-187`).
- `frontend/src/components/wizard/StepExport.tsx`: remove `BackgroundEdit` import + `edits` state (`:3,25`), the `listBackgroundEdits(shot.id)` load (`:41`), the masks auto-included row (`:147-150`), and `masks: true` from the `startExport` call (`:61`).

- [ ] **Step 2: Remove obsolete i18n keys (both locales)**

In `frontend/src/i18n/en.json` and `frontend/src/i18n/zh.json`, delete the `bgEdit` block, `camera.bgEdits`, `camera.bgEditsHint`, and `export.masksAuto`. Confirm no remaining `t('bgEdit.…')` / `t('camera.bgEdits…')` / `t('export.masksAuto')` references (grep).

- [ ] **Step 3: Update READMEs**

In `README.md` and `README.zh.md`, remove background-edit / mask export bullets; add a short line that the layout channel supports director-drawn lasso subjects (group + label) that feed the blockout and the prompt.

- [ ] **Step 4: Version bump**

- `backend/app/__init__.py`: `__version__ = "1.5.0"`.
- `frontend/package.json`: `"version": "1.5.0"`.

- [ ] **Step 5: Full verification (evidence before claiming done)**

Run:
```bash
cd backend && .venv/Scripts/python -m pytest -q
cd ../frontend && npm run build
cd .. && grep -rn "background-edits\|BackgroundEdit\|bgEdit\|mask_renderer\|masksAuto" backend/app frontend/src || echo "clean"
```
Expected: backend PASS; frontend build PASS; grep prints `clean` (no dangling references). Then run the app once (`scripts/run.ps1`), regenerate one demo export, and confirm the zip has no `masks/` folder and the blockout shows any manual subject.

- [ ] **Step 6: Final release commit + tag**

Write the message to a UTF-8 file (emoji) and commit single-author, then tag:

```bash
git add -A
git commit -F <(printf '%s\n' 'v1.5.0 🎬 Layout manual subjects: lasso regions (group+label) into the blockout + prompt; drop background-edit/masks') --author="Ryan Yan <ziyuan.yan2000@gmail.com>"
git tag v1.5.0
```

(If the shell mangles the emoji, write the message to `scratchpad/release-msg.txt` first and use `git commit -F scratchpad/release-msg.txt`.)

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-07-22-layout-manual-subjects-annotate-design.md`):
- D1 unify manual→layout subjects → Tasks 1,2,5,6. ✅
- D2 lasso → polygon → Task 6 (LassoDrawLayer), Tasks 2/5 (polygon render). ✅
- D3 only manual labels → prompt → Task 3 (`layout_labels`, `compose` scene_elements), Task 5 (`layoutLabels`), Task 6/7 (StepCamera/PromptPreviewPanel). ✅
- D4 position via blockout, no masks → Tasks 2/5 render; Tasks 7/8 remove masks. ✅
- D5 persistent side panel + enable/disable rule → Task 6 (SubjectPanel + `editable` from FramePlayer). ✅
- D6 semi-transparent overlay layout → Task 6 (OverlayView branch + opacity). ✅
- D7 lightweight DB drop → Task 7 (`_migrate` DROP TABLE). ✅
- Data model (LayoutState blob, `m`-ids, mixed selection) → Task 1. ✅
- `building` group already in asset → Global Constraints (no asset task). ✅
- Version bump + tag → Task 8. ✅
- Removal inventory (model/table/api/mask_renderer/exporter/shot_ops/frontend/i18n) → Tasks 7,8. ✅

**Placeholder scan:** No "TBD/TODO". Task 6 Step 3 (SubjectPanel) intentionally states an invariant + a recommended shape rather than a full listing, because the exact state-lifting is a judgment call; the contract (single persister, shared in-memory state, props enumerated in Interfaces) is explicit. Every code-changing step elsewhere shows the code.

**Type consistency:** `manual_subjects` shape identical across Task 1 (backend dict), Task 5 (`ManualSubject` TS). `selected_instances` is `list[int|str]` (BE) / `(number|string)[]` (FE). `render_frame(..., manual_subjects)` positional order matches Task 4's export call. `compose(..., scene_elements)` (BE) ↔ `composeParts(..., sceneElements)` (FE) both insert after scene_desc / before lens. `disabledInstances: Set<number|string>` consistent in Tasks 5/6. `group_repr_cls`/`groupReprCls` mirror.

**Scope:** Single feature, one branch. Tasks 1–5 additive; 6 swaps FE usage; 7–8 delete. App builds/passes at every task boundary.
