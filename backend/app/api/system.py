import logging
import os
import subprocess
import sys
import threading
import time
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings as app_config
from app.db import get_db
from app.models import Film
from app.schemas import SettingsUpdate
from app.services import app_settings, demos, hardware, model_manager, paths

log = logging.getLogger(__name__)
router = APIRouter(tags=["system"])

RESET_CONFIRM = "Understudy"


def _installed_provider() -> str:
    """Which onnxruntime build is actually installed right now."""
    try:
        import onnxruntime as ort

        return "directml" if "DmlExecutionProvider" in ort.get_available_providers() else "cpu"
    except Exception:
        return "cpu"


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)) -> dict:
    return app_settings.get_all(db)


@router.put("/settings")
def put_settings(body: SettingsUpdate, db: Session = Depends(get_db)) -> dict:
    result = app_settings.update(db, body.values)
    if "ort_provider" in body.values:
        result["requires_reinstall"] = True
    return result


@router.get("/system/hardware")
def get_hardware(refresh: bool = False, db: Session = Depends(get_db)) -> dict:
    cached = app_settings.get(db, "hardware_profile")
    if cached and not refresh:
        return cached
    profile = hardware.detect()
    app_settings.update(db, {"hardware_profile": profile})
    return profile


@router.get("/system/models")
def list_models() -> list[dict]:
    """Read-only model status (downloads are handled automatically)."""
    return model_manager.list_models()


class SwitchProvider(BaseModel):
    provider: Literal["cpu", "directml", "coreml"]


@router.post("/system/switch-provider")
def switch_provider(body: SwitchProvider, db: Session = Depends(get_db)) -> dict:
    """Save the inference backend. On Windows, cpu<->directml are separate
    onnxruntime packages, so a detached helper swaps the package and relaunches
    the app when the installed build doesn't match. On macOS, CoreML and CPU
    both ship in the one wheel, so switching is instant — no reinstall/restart."""
    app_settings.update(db, {"ort_provider": body.provider})

    # macOS / Linux: nothing to reinstall — the setting takes effect next extraction.
    if sys.platform != "win32" or body.provider not in ("cpu", "directml"):
        return {"restarting": False, "provider": body.provider}

    if _installed_provider() == body.provider:
        # already the right build — nothing to reinstall or restart
        return {"restarting": False, "provider": body.provider}

    script = app_config.root_dir / "scripts" / "apply_provider.ps1"
    exe = app_config.root_dir / "Understudy.exe"
    if not script.exists() or not exe.exists():
        # can't auto-restart (e.g. dev/console mode) — fall back to manual guide
        return {"restarting": False, "manual": True, "provider": body.provider}

    DETACHED = 0x00000008  # DETACHED_PROCESS
    NEW_GROUP = 0x00000200  # CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(
        [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script),
            "-Provider", body.provider, "-WaitPid", str(os.getpid()),
        ],
        creationflags=DETACHED | NEW_GROUP,
        close_fds=True,
        cwd=str(app_config.root_dir),
    )

    # Give the response time to reach the UI, then exit so the helper can
    # replace the in-use onnxruntime files and relaunch.
    def _shutdown() -> None:
        time.sleep(1.5)
        os._exit(0)

    threading.Thread(target=_shutdown, daemon=True).start()
    log.info("Switching provider to %s; app will restart", body.provider)
    return {"restarting": True, "provider": body.provider}


class ResetRequest(BaseModel):
    confirm: str
    lang: str | None = None  # language the UI is showing, so demo titles match


@router.post("/system/reset")
def reset_all(body: ResetRequest, db: Session = Depends(get_db)) -> dict:
    """Wipe every film and its files, then recreate the bundled demos in the
    language the UI is showing. Guarded by a typed confirmation phrase."""
    if body.confirm.strip() != RESET_CONFIRM:
        return {"ok": False, "error": "confirmation_mismatch"}

    for film in db.query(Film).all():
        db.delete(film)  # cascades to shots/params/prompts/board/lens
    db.commit()
    paths.reset_films_dir()

    seeded = demos.seed_demos(db, lang=body.lang)
    app_settings.update(db, {"demos_seeded": True})
    log.info("Reset complete; reseeded %d demo shots", seeded)
    return {"ok": True, "demo_shots": seeded}
