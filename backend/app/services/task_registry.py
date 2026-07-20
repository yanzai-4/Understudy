"""In-memory task registry for long-running jobs (extraction, export, downloads).

Tasks are ephemeral: results are persisted to the DB/filesystem by the job itself,
so a process restart only loses progress bars, never data.
"""

import threading
import time
import uuid
from dataclasses import dataclass, field


@dataclass
class Task:
    id: str
    kind: str  # extract | export | model_download
    status: str = "queued"  # queued | running | done | error | cancelled
    progress: float = 0.0
    stage: str = ""
    error: str | None = None
    result: dict | None = None
    created_at: float = field(default_factory=time.time)
    cancel_requested: bool = False

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": round(self.progress, 4),
            "stage": self.stage,
            "error": self.error,
            "result": self.result,
        }


class TaskRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tasks: dict[str, Task] = {}

    def create(self, kind: str) -> str:
        task = Task(id=uuid.uuid4().hex, kind=kind)
        with self._lock:
            self._prune()
            self._tasks[task.id] = task
        return task.id

    def get(self, task_id: str) -> dict | None:
        with self._lock:
            task = self._tasks.get(task_id)
            return task.snapshot() if task else None

    def has_active(self, kind: str) -> bool:
        with self._lock:
            return any(
                t.kind == kind and t.status in ("queued", "running") for t in self._tasks.values()
            )

    def start(self, task_id: str) -> None:
        self._update(task_id, status="running")

    def set_progress(self, task_id: str, progress: float, stage: str) -> None:
        self._update(task_id, progress=max(0.0, min(1.0, progress)), stage=stage)

    def finish(self, task_id: str, result: dict | None = None) -> None:
        self._update(task_id, status="done", progress=1.0, result=result)

    def fail(self, task_id: str, error: str) -> None:
        self._update(task_id, status="error", error=error)

    def mark_cancelled(self, task_id: str) -> None:
        self._update(task_id, status="cancelled")

    def request_cancel(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.status not in ("queued", "running"):
                return False
            task.cancel_requested = True
            return True

    def is_cancel_requested(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks.get(task_id)
            return bool(task and task.cancel_requested)

    def _update(self, task_id: str, **fields) -> None:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return
            for key, value in fields.items():
                setattr(task, key, value)

    def _prune(self, max_age_sec: float = 24 * 3600) -> None:
        """Drop finished tasks older than a day (caller holds the lock)."""
        cutoff = time.time() - max_age_sec
        stale = [
            tid
            for tid, t in self._tasks.items()
            if t.created_at < cutoff and t.status in ("done", "error", "cancelled")
        ]
        for tid in stale:
            del self._tasks[tid]


registry = TaskRegistry()


class TaskCancelled(Exception):
    pass
