#!/usr/bin/env bash
# Build Understudy.app — the double-click launcher — at the repo root (macOS).
# The bundle's executable is a thin shell script that runs backend/desktop.py
# with the venv's python; that one process owns both the FastAPI server and the
# WKWebView window, so closing the window stops everything. Locally built .apps
# aren't quarantined by Gatekeeper, so no signing is needed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/Understudy.app"
RES="$APP/Contents/Resources"
MACOS="$APP/Contents/MacOS"
SRC_PNG="$ROOT/scripts/launcher/logo_256.png"

VERSION="$("$ROOT/.venv/bin/python" -c 'import sys; sys.path.insert(0, "'"$ROOT"'/backend"); import app; print(app.__version__)' 2>/dev/null || echo "0.1.2")"

echo "Assembling $APP (v$VERSION) ..."
rm -rf "$APP"
mkdir -p "$RES" "$MACOS"

# --- icon: build understudy.icns from the 256px logo (best-effort) ---
if command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1 && [ -f "$SRC_PNG" ]; then
  TMP="$(mktemp -d)"; ICONSET="$TMP/understudy.iconset"; mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s" "$SRC_PNG" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2)); sips -z "$d" "$d" "$SRC_PNG" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$RES/understudy.icns"
  rm -rf "$TMP"
  echo "  icon: understudy.icns"
else
  echo "  (sips/iconutil or logo missing — app will use a default icon)"
fi

# --- Info.plist ---
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Understudy</string>
  <key>CFBundleDisplayName</key><string>Understudy</string>
  <key>CFBundleIdentifier</key><string>io.yanzai.understudy</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Understudy</string>
  <key>CFBundleIconFile</key><string>understudy.icns</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
PLIST

# --- launcher executable ---
cat > "$MACOS/Understudy" <<'LAUNCH'
#!/bin/bash
# Understudy launcher (macOS). Runs the Python desktop entry point which owns
# both the FastAPI server and the WKWebView window.
DIR="$(cd "$(dirname "$0")" && pwd)"
# The .app sits at the repo root: .../Understudy.app/Contents/MacOS/Understudy
ROOT="$(cd "$DIR/../../.." && pwd)"
PY="$ROOT/.venv/bin/python"
DESKTOP="$ROOT/backend/desktop.py"
DIST="$ROOT/frontend/dist/index.html"
if [ ! -x "$PY" ] || [ ! -f "$DESKTOP" ] || [ ! -f "$DIST" ]; then
  osascript -e 'display dialog "未找到运行环境，请先在终端运行 scripts/mac/setup.sh 完成安装。

Runtime not found. Run scripts/mac/setup.sh in Terminal first." with title "Understudy" buttons {"OK"} with icon caution'
  exit 1
fi
cd "$ROOT/backend"
exec "$PY" "$DESKTOP"
LAUNCH
chmod +x "$MACOS/Understudy"

echo "Done: $APP"
echo "Double-click Understudy.app to launch (or drag it to your Dock)."
