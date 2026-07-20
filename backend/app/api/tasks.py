from fastapi import APIRouter

from app.api.deps import api_error
from app.services.task_registry import registry

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("/{task_id}")
def get_task(task_id: str) -> dict:
    snapshot = registry.get(task_id)
    if snapshot is None:
        raise api_error(404, "task_not_found", f"Task {task_id} does not exist")
    return snapshot


@router.post("/{task_id}/cancel")
def cancel_task(task_id: str) -> dict:
    if not registry.request_cancel(task_id):
        raise api_error(409, "not_cancellable", "Task is not running")
    return {"ok": True}
