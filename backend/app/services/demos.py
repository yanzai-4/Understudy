"""Bundled demo content: a multi-scene / multi-project example set that ships
with the app. Demos are seeded on first launch and recreated on reset; they can
be freely deleted otherwise. Titles follow the current UI language.

Each shot points at a pre-extracted asset directory under assets/demos/<asset>/
(source + frames + pose/depth/canny + extraction.json), so seeding is an instant
file copy — no re-extraction needed.
"""

import json
import logging
import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from app.models import BoardState, CameraParams, Film, PromptRecord, Shot
from app.services import app_settings, paths
from app.services.prompt_builder import compose, load_mappings

log = logging.getLogger(__name__)

ASSETS = Path(__file__).resolve().parent.parent / "assets" / "demos"

Loc = dict  # {"zh": ..., "en": ...}

DEMO_FILMS: list[dict] = [
    {
        "name": {"zh": "示例 · 都市短片", "en": "Demo · City Short"},
        "description": {
            "zh": "多场景示例：走廊 → 路口 → 街边。真实素材，可随时删除",
            "en": "Multi-scene demo: corridor → crossing → street. Real footage, delete anytime",
        },
        "default_camera_params": {"color_grade": "teal_orange", "style_suffix": "cinematic"},
        # Scene 1 (corridor) holds two takes/versions; scene edges are seeded
        # onto the whiteboard to show the shot sequence.
        "shots": [
            {
                "asset": "corridor", "scene_no": 1, "version": 1,
                "name": {"zh": "走廊·走向镜头", "en": "Corridor · toward camera"},
                "tags": {"zh": ["示例", "室内"], "en": ["demo", "interior"]},
                "camera": {"shot_size": "medium", "camera_move": "push_in", "aperture": "f2_8",
                           "light_position": "back", "light_quality": "soft", "light_mood": "window",
                           "time_ambience": "morning"},
                "subject": {"zh": "两人沿走廊走向镜头", "en": "two people walking toward the camera down a corridor"},
                "scene": {"zh": "光线昏暗的现代办公走廊", "en": "a dim modern office corridor"},
            },
            {
                "asset": "corridor", "scene_no": 1, "version": 2,
                "name": {"zh": "走廊·走向镜头", "en": "Corridor · toward camera"},
                "tags": {"zh": ["示例", "室内"], "en": ["demo", "interior"]},
                "camera": {"shot_size": "medium", "camera_move": "push_in", "aperture": "f2_8",
                           "light_position": "back", "light_quality": "soft", "light_mood": "window",
                           "time_ambience": "night", "color_grade": "cool"},
                "subject": {"zh": "两人沿走廊走向镜头", "en": "two people walking toward the camera down a corridor"},
                "scene": {"zh": "光线昏暗的现代办公走廊", "en": "a dim modern office corridor"},
            },
            {
                "asset": "cross", "scene_no": 2, "version": 1,
                "name": {"zh": "路口人群", "en": "Crossing crowd"},
                "tags": {"zh": ["示例", "人群"], "en": ["demo", "crowd"]},
                "camera": {"shot_size": "wide", "camera_move": "static", "aperture": "f5_6",
                           "light_position": "top", "light_quality": "hard", "time_ambience": "noon"},
                "subject": {"zh": "人群穿过繁忙路口", "en": "a crowd crossing a busy intersection"},
                "scene": {"zh": "高楼之间的宽阔市中心斑马线", "en": "a wide downtown crosswalk between tall buildings"},
            },
            {
                "asset": "street", "scene_no": 3, "version": 1,
                "name": {"zh": "街边走过", "en": "Street pass-by"},
                "tags": {"zh": ["示例", "街景"], "en": ["demo", "street"]},
                "camera": {"shot_size": "full", "camera_move": "static", "aperture": "f5_6",
                           "light_position": "front", "light_quality": "soft", "time_ambience": "morning"},
                "subject": {"zh": "行人走过店铺门前", "en": "pedestrians walking past a storefront"},
                "scene": {"zh": "灰调城市街道，有商铺和货车", "en": "a grey city street with shops and a delivery truck"},
            },
        ],
    },
    {
        "name": {"zh": "示例 · 广场行人", "en": "Demo · Plaza"},
        "description": {
            "zh": "单场景示例：固定机位广场，多名行人经过。可随时删除",
            "en": "Single-scene demo: a locked-off courtyard with passing pedestrians. Delete anytime",
        },
        "shots": [
            {
                "asset": "plaza", "scene_no": 1, "version": 1,
                "name": {"zh": "广场穿行", "en": "Across the plaza"},
                "tags": {"zh": ["示例", "广场"], "en": ["demo", "plaza"]},
                "camera": {"shot_size": "wide", "camera_angle": "high", "camera_move": "static",
                           "aperture": "f11", "light_position": "top", "light_quality": "soft",
                           "weather": "overcast"},
                "subject": {"zh": "行人穿过广场", "en": "people crossing a courtyard"},
                "scene": {"zh": "俯视砖楼环绕的广场", "en": "an overhead view of a brick-building courtyard"},
            },
        ],
    },
]

CAMERA_COLS = [
    "shot_size", "camera_angle", "focal_length", "aperture", "camera_move",
    "light_position", "light_quality", "light_mood", "time_ambience", "weather",
    "color_grade", "style_suffix",
]


def demos_available() -> bool:
    return ASSETS.exists() and any(ASSETS.iterdir())


def _lang(db: Session) -> str:
    return "en" if app_settings.get(db, "language") == "en" else "zh"


def seed_demos(db: Session, lang: str | None = None) -> int:
    """Create the bundled demo films/shots by copying pre-extracted asset
    directories. Titles follow `lang` if given (the language the UI is showing),
    otherwise the stored setting. Returns the number of shots created."""
    if not demos_available():
        log.warning("No bundled demo assets found at %s — skipping seed", ASSETS)
        return 0

    lang = lang if lang in ("zh", "en") else _lang(db)
    mappings = load_mappings()
    created = 0

    for film_def in DEMO_FILMS:
        film = Film(
            name=film_def["name"][lang],
            description=film_def["description"][lang],
            default_camera_params=film_def.get("default_camera_params"),
        )
        db.add(film)
        db.flush()
        (paths.film_dir(film.id) / "shots").mkdir(parents=True, exist_ok=True)

        scene_nos: list[int] = []
        for shot_def in film_def["shots"]:
            asset_dir = ASSETS / shot_def["asset"]
            if not asset_dir.exists():
                log.warning("Demo asset missing: %s", asset_dir)
                continue
            if shot_def["scene_no"] not in scene_nos:
                scene_nos.append(shot_def["scene_no"])
            shot = Shot(
                film_id=film.id,
                name=shot_def["name"][lang],
                scene_no=shot_def["scene_no"],
                version=shot_def.get("version", 1),
                tags=shot_def["tags"][lang],
                status="extracted",
                source_filename=f"{shot_def['asset']}.mp4",
            )
            db.add(shot)
            db.flush()

            dst = paths.shot_dir(film.id, shot.id)
            shutil.copytree(asset_dir, dst)

            meta = json.loads((dst / "extraction.json").read_text(encoding="utf-8"))
            src = meta.get("source", {})
            shot.video_width = src.get("width")
            shot.video_height = src.get("height")
            shot.video_fps = src.get("fps")
            shot.video_frame_count = src.get("frame_count")
            if src.get("fps"):
                shot.video_duration_sec = round(src["frame_count"] / src["fps"], 2)
            shot.extract_stride = meta.get("stride")
            shot.extract_max_size = meta.get("max_size")
            shot.extract_frame_count = meta.get("frame_count")
            shot.extracted_channels = meta.get("channels")

            params = CameraParams(shot_id=shot.id)
            for col in CAMERA_COLS:
                setattr(params, col, shot_def["camera"].get(col))
            params.subject_desc = shot_def["subject"][lang]
            params.scene_desc = shot_def["scene"][lang]
            db.add(params)
            db.flush()

            snapshot = {c: getattr(params, c) for c in CAMERA_COLS}
            snapshot.update(subject_desc=params.subject_desc, scene_desc=params.scene_desc,
                            custom_positive="", custom_negative="")
            positive, negative = compose(snapshot, mappings)
            db.add(PromptRecord(shot_id=shot.id, positive_prompt=positive,
                                negative_prompt=negative, params_snapshot=snapshot))
            created += 1

        # Seed a whiteboard: link the scene frames left-to-right so the film's
        # shot sequence is visible out of the box (positions are auto-tidied
        # on open; only the connections need to persist).
        ordered = sorted(scene_nos)
        if len(ordered) >= 2:
            edges = [
                {
                    "id": f"e-demo-{a}-{b}",
                    "source": f"scene:{a}",
                    "target": f"scene:{b}",
                    "sourceHandle": "r",
                    "targetHandle": "l",
                }
                for a, b in zip(ordered, ordered[1:])
            ]
            db.add(BoardState(film_id=film.id, data={"nodes": {}, "scenes": {}, "edges": edges}))

    db.commit()
    log.info("Seeded %d demo shots (lang=%s)", created, lang)
    return created
