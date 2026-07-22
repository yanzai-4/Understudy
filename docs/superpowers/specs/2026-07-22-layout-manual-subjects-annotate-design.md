# Design: Unified layout subjects + freehand annotate → prompt

Date: 2026-07-22
Status: Approved (design), pending implementation plan

## Problem

The "Preview & Annotate" wizard step and the Layout channel have three coupled problems:

1. **Layout is invisible in overlay mode.** `ChannelToggle` advertises a `layout`
   chip in overlay, but `OverlayView` has no layout branch — enabling it does
   nothing. Layout is only ever drawn in split mode inside `LayoutPanel`.
2. **Subject curation is buried.** The subject checkboxes live in a 9px footer
   *below* the split-mode layout canvas, invisible in overlay mode.
3. **The old "background edit" is the wrong model.** It was designed to edit an
   existing background *image* (`edit_type ∈ {remove, add, replace}`, rectangle
   box → white mask PNG). But the AI regenerates the video from scratch and never
   sees the original footage, so "remove"/"replace" have nothing to act on, and
   the annotation text never reaches `prompt.txt` at all — it only ships as mask
   PNGs + a JSON sidecar that nothing downstream consumes. The `camera.bgEditsHint`
   string even claims the text is "exported as prompts", which was never wired.

## Goal

Make the director's intent flow to the AI through two clean channels:

- **Position** is carried by the layout blockout image (a coarse structural guide).
- **Semantics** are carried by the positive prompt text.

Unify everything the director wants in the scene into one concept — **layout
subjects** — whether detected by YOLOX or drawn by hand. Delete the image-editing
"background edit" machinery entirely.

## Core concept

A **layout subject** is anything the director wants the AI to place in the scene:

- **Detected subjects** — from YOLOX (person / vehicle / animal / props),
  produced by the layout extractor into `scene.json`. Structural only.
- **Manual subjects** — drawn by the director with a freehand lasso, carrying a
  group + optional text label. Structural *and* semantic (label feeds the prompt).

Both are curated in one side panel (checkboxes), both render in the layout
blockout, and the blockout is now shown semi-transparent on the overlay.

## Decisions (locked)

| # | Decision |
|---|----------|
| D1 | Manual regions are **unified into the Layout channel** as static subjects (not a separate annotation layer). |
| D2 | Manual region shape = **freehand lasso → simplified polygon** (vector, stored as normalized points). Rectangle/box drawing is removed. |
| D3 | **Only manual-subject labels** feed `prompt.txt`. Detected subjects stay structural-only (no prompt text). |
| D4 | **Position is conveyed by the blockout render; no per-region masks.** The entire mask / background-edit machinery is removed. |
| D5 | The subject-curation panel is a **persistent side panel** (right of the viewport), visible in both overlay and split. Editable when `split` OR `(overlay AND layout toggle ON)`; greyed/read-only when `overlay AND layout toggle OFF`. |
| D6 | Layout renders **semi-transparent on the overlay** (opacity slider, like depth). |
| D7 | DB handling for dropping `background_edits`: **lightweight rebuild/migration**, not full Alembic (local desktop app, regenerable demo data). |

## Data model

Manual subjects are **user data**, so they live in the existing `LayoutState`
JSON blob (per-shot, alongside `selected_instances` / `disabled_backdrop`) — NOT
in `scene.json`, which is regenerated on every re-extraction. Render merges the
two sources.

```jsonc
// LayoutState.state (JSON blob, backend/app/models.py LayoutState)
{
  "selected_instances": ["3", "7", "m1"] | null,   // null = show all (unchanged)
  "disabled_backdrop": ["top"],                      // unchanged
  "manual_subjects": [
    {
      "id": "m1",                 // "m"-prefixed, namespaced to avoid colliding
                                  //   with detected integer instance ids
      "group": "building",        // building | props | vehicle | person | animal
      "label": "ancient temple",  // optional free text; feeds the prompt
      "polygon": [[0.12, 0.30], [0.20, 0.28], ...]   // normalized 0-1, closed
    }
  ]
}
```

- `selected_instances` now references both detected ids and manual ids in one list.
- Manual subjects are **static** (apply to all frames).
- New group **`building`** is added to `ade20k.json`: `group_order`,
  `blockout_palette` color, and i18n label. Detection never emits `building`;
  it exists for manual subjects only. Default group for a new manual subject =
  `building`.
- `scene.json` version is unchanged (manual subjects are not stored there).
  Reading a `LayoutState` without `manual_subjects` defaults it to `[]`
  (backward compatible with existing shots).

## Components & changes

### Frontend

- **`OverlayView.tsx`** — add a `layout` branch: render the blockout
  semi-transparent over the base frame, with an opacity slider (mirror the depth
  treatment). Fed by the same scene + manual subjects.
- **`FramePlayer.tsx` / `StepPreview.tsx`** — hoist the subject-curation panel to
  a persistent side panel beside the viewport (both modes). Remove the
  overlay-mode annotate sidebar.
- **New `SubjectPanel`** (extracted from `LayoutPanel`'s footer) — grouped subject
  list with checkboxes, the "Draw region" lasso tool, and backdrop plane toggles.
  Enable/disable per D5. Persists to `LayoutState` (debounced `putLayoutState`).
- **New `LassoDrawLayer`** (replaces `BoxDrawLayer`) — freehand outline capture on
  the overlay; auto-close + simplify to a polygon on release; vertex-drag editing.
- **Inline manual-subject form** (replaces `BackgroundEditModal`) — group dropdown
  (default `building`) + optional label, shown after a lasso is drawn.
- **`layoutScene.ts` `drawScene`** — render manual subjects as filled polygons
  (canvas path fill), depth-shaded by group in the blockout/ade palette.
- **`promptCompose.ts`** — append deduped manual-subject labels as a "scene
  elements" fragment after `scene_desc`.
- **`PromptPreviewPanel.tsx`** — remove the orphaned "Background edit intents"
  block; the labels now appear inline in the composed prompt.
- **Remove** `BoxDrawLayer.tsx`, `BackgroundEditModal.tsx`, background-edit CRUD in
  `endpoints.ts`, `BackgroundEdit`/`EditType` in `types.ts`, `ExportInclude.masks`
  handling in `StepExport.tsx`, and the related i18n keys (incl. `camera.bgEditsHint`).

### Backend

- **`layout_scene.py`**
  - `render_frame` — accept manual subjects; render each as a filled polygon
    (`cv2.fillPoly`), depth-shaded by group in the blockout palette. Manual
    subjects have no measured depth, so assign a default depth by group for the
    far→near sort (`building` = far; others = mid). Merge with detected instances.
  - `build_scene` / selection helpers — treat manual ids as valid selectable ids.
- **`prompt_builder.py` `compose()`** — append deduped manual-subject labels as a
  "scene elements" fragment after `scene_desc` (mirror of `promptCompose.ts`).
- **`layout.py` API** — `PUT /shots/{id}/layout` accepts and persists
  `manual_subjects`; `normalize_layout_state` validates/normalizes them.
- **`exporter.py`** — re-render blockout PNGs including manual subjects; include
  `scene.json` + the merged `LayoutState`; put manual labels in `metadata.json`
  (they are already in `prompt.txt`). Remove `include_masks`, the `masks/` dir,
  `masks/background_edits.json`, and `background_edits` from metadata.
- **`shot_ops.py`** — drop `BackgroundEdit` clone + mask re-render; `LayoutState`
  (with `manual_subjects`) is already cloned.
- **Remove** `background.py` API, `mask_renderer.py`, the `BackgroundEdit` model +
  `Shot.background_edits` relationship, and the `background_edits` table (D7:
  lightweight rebuild/migration).

## Data flow

```
Director lassos a region on the overlay
  → LassoDrawLayer captures + simplifies to a polygon
  → inline form: group (default building) + optional label
  → PUT /shots/{id}/layout  { manual_subjects: [...] }  (LayoutState blob)
  → SubjectPanel shows it (checkbox) + drawScene renders it (blockout, overlay)

At prompt compose (compose() / composeParts()):
  manual-subject labels (deduped, grouped) → "scene elements" fragment
  → positive prompt

At export:
  scene.json (detected) + LayoutState (manual + curation)
  → render blockout PNGs (detected + manual polygons)
  → prompt.txt (with manual labels) + metadata.json (labels)
  (no masks/, no background_edits.json)
```

## Kept-in-sync pairs (must edit both sides)

- `layout_scene.py render_frame` ↔ `layoutScene.ts drawScene` (polygon render)
- `prompt_builder.py compose` ↔ `promptCompose.ts composeParts` (label fragment)

## Testing

- Backend: manual-subject persistence + normalization; `render_frame` polygon
  fill + depth ordering; `compose()` label fragment (dedupe, ordering, empty
  case); exporter no longer emits masks; clone carries manual subjects. Update
  the existing background-edit tests (remove) and layout/prompt tests.
- Frontend: build + i18n parity (EN/ZH) after key removals/additions; the
  three baked demos regenerate cleanly.
- Manual: draw a lasso region → appears in panel + overlay + split + prompt;
  overlay layout opacity + enable/disable rule per D5; export zip contains no
  `masks/` and a blockout showing the manual region.

## Scope

One focused, all-or-nothing pass (remove old feature + add lasso tool + unified
side panel + overlay layout + prompt wiring + export changes + DB rebuild), so the
app is never left half-broken. This is a version bump (layout channel behavior
change) — bump `backend/app/__init__.py` + `frontend/package.json` and tag on
completion per the repo's release convention.

## Out of scope

- SAM 3 GPU quality tier (deferred — needs a discrete GPU, this machine has none).
- Regional/spatial prompt conditioning downstream (ComfyUI regional nodes) — the
  export stays a human-consumed package; position is conveyed by the blockout image.
- Paint-brush (raster) region tool — lasso polygon only for now.
- Deleting/replacing detected subjects or a building classifier — add-only manual
  subjects; detected subjects are curated by show/hide only.
