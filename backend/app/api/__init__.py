from fastapi import APIRouter

from app.api import (
    background,
    camera,
    exports,
    extraction,
    films,
    lens,
    shots,
    system,
    tasks,
    uploads,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(films.router)
api_router.include_router(shots.router)
api_router.include_router(uploads.router)
api_router.include_router(extraction.router)
api_router.include_router(background.router)
api_router.include_router(camera.router)
api_router.include_router(lens.router)
api_router.include_router(exports.router)
api_router.include_router(tasks.router)
api_router.include_router(system.router)
