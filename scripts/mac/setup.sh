#!/usr/bin/env bash
# Understudy first-time setup (macOS): create the Python 3.11 venv, install
# backend + frontend deps, build the SPA, and pre-download the models.
# ML wheels (onnxruntime, opencv, rtmlib) don't support 3.13/3.14 yet.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

find_py() {
  local candidates=(
    python3.11
    /opt/homebrew/bin/python3.11
    /usr/local/bin/python3.11
    /Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11
  )
  for c in "${candidates[@]}"; do
    if "$c" -c 'import sys; raise SystemExit(0 if sys.version_info[:2]==(3,11) else 1)' >/dev/null 2>&1; then
      echo "$c"; return 0
    fi
  done
  if command -v pyenv >/dev/null 2>&1; then
    local pv; pv="$(pyenv versions --bare 2>/dev/null | grep '^3\.11\.' | tail -1 || true)"
    if [ -n "$pv" ]; then echo "$(pyenv root)/versions/$pv/bin/python3.11"; return 0; fi
  fi
  return 1
}

PY="$(find_py || true)"
if [ -z "${PY:-}" ]; then
  echo "Python 3.11 not found. Install it first, e.g.:  brew install python@3.11" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js / npm not found. Install it first, e.g.:  brew install node" >&2
  exit 1
fi

echo "[1/5] Using $PY"
[ -d "$ROOT/.venv" ] || "$PY" -m venv "$ROOT/.venv"
VENV_PY="$ROOT/.venv/bin/python"

echo "[2/5] Installing backend dependencies..."
"$VENV_PY" -m pip install --upgrade pip -q
"$VENV_PY" -m pip install -r "$ROOT/backend/requirements.txt"

echo "[3/5] Installing frontend dependencies..."
( cd "$ROOT/frontend" && npm install )

echo "[4/5] Building frontend..."
( cd "$ROOT/frontend" && npm run build )

echo "[5/5] Downloading extraction models (pose + depth)..."
( cd "$ROOT/backend" && "$VENV_PY" -c "from app.services import model_manager; model_manager.download_required_cli()" ) \
  || echo "Model download failed — the app will retry automatically on first extraction."

echo ""
echo "Setup complete. Build the launcher with:  bash scripts/mac/build_app.sh"
echo "Then double-click Understudy.app to start."
