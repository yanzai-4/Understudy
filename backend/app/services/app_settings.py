"""Global settings stored as JSON key/values in the settings table."""

from sqlalchemy.orm import Session

from app.models import Setting

DEFAULTS: dict = {
    "first_run_completed": False,
    "demos_seeded": False,  # bundled demos are created once (first launch / reset)
    "language": "en",
    "ort_provider": "cpu",  # cpu | directml
    "default_max_size": 768,
    "default_stride_mode": "auto",  # "auto" or an integer stride
    "depth_model_variant": "int8",  # int8 | fp32
    "hardware_profile": None,
}


def get_all(db: Session) -> dict:
    values = dict(DEFAULTS)
    for row in db.query(Setting).all():
        values[row.key] = row.value
    return values


def get(db: Session, key: str):
    row = db.get(Setting, key)
    if row is not None:
        return row.value
    return DEFAULTS.get(key)


def update(db: Session, values: dict) -> dict:
    for key, value in values.items():
        if key not in DEFAULTS:
            continue
        row = db.get(Setting, key)
        if row is None:
            db.add(Setting(key=key, value=value))
        else:
            row.value = value
    db.commit()
    return get_all(db)
