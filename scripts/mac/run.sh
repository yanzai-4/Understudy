#!/usr/bin/env bash
# Run Understudy in the browser (macOS fallback — no native window).
# FastAPI serves the built SPA on one port; the default browser opens to it.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_PY="$ROOT/.venv/bin/python"

[ -x "$VENV_PY" ] || { echo "venv not found. Run scripts/mac/setup.sh first." >&2; exit 1; }
[ -f "$ROOT/frontend/dist/index.html" ] || { echo "Frontend build not found. Run scripts/mac/setup.sh first." >&2; exit 1; }

URL="http://127.0.0.1:8000"
echo "Starting Understudy at $URL ..."
( sleep 2; open "$URL" ) &

cd "$ROOT/backend"
exec "$VENV_PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
