#!/usr/bin/env bash
# Development mode (macOS): FastAPI on :8000 (reload) + Vite dev server on
# :5173 (HMR). Open http://localhost:5173 while developing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_PY="$ROOT/.venv/bin/python"

[ -x "$VENV_PY" ] || { echo "venv not found. Run scripts/mac/setup.sh first." >&2; exit 1; }

( cd "$ROOT/backend" && "$VENV_PY" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 ) &
BACK=$!
trap 'kill "$BACK" 2>/dev/null || true' EXIT

cd "$ROOT/frontend"
npm run dev
