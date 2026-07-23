from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.api import api_router
from app.config import settings
from app.db import init_db


class SPAStaticFiles(StaticFiles):
    """Serve the built SPA, falling back to index.html for client-side routes."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise

app = FastAPI(title="Understudy", version=__version__)

# Dev mode: vite dev server on :5173 proxies /api here, but allow direct calls too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


app.include_router(api_router)


@app.on_event("startup")
def on_startup() -> None:
    settings.ensure_dirs()
    from app.services.model_manager import seed_bundled_models

    seed_bundled_models()
    init_db()
    _seed_demos_on_first_launch()


def _seed_demos_on_first_launch() -> None:
    """Create the bundled demo films the first time the app ever starts. The
    flag makes this one-shot, so demos the user later deletes stay deleted
    (they only come back on an explicit reset)."""
    import logging

    from app.db import SessionLocal
    from app.services import app_settings, demos

    log = logging.getLogger(__name__)
    db = SessionLocal()
    try:
        if app_settings.get(db, "demos_seeded"):
            return
        if demos.demos_available():
            demos.seed_demos(db)
        app_settings.update(db, {"demos_seeded": True})
    except Exception:
        log.exception("First-launch demo seeding failed")
    finally:
        db.close()


# Serve extracted frame assets directly from the data directory.
app.mount("/files", StaticFiles(directory=str(settings.films_dir), check_dir=False), name="files")

# Production: serve the built SPA. In dev the vite server handles the UI.
if settings.frontend_dist.exists():
    app.mount("/", SPAStaticFiles(directory=str(settings.frontend_dist), html=True), name="spa")
