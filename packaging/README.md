# Building the desktop app

Produces a standalone, double-click app (no Python/Node/deps, no first-run
download for depth + layout). CI does this automatically on a `v*` tag
(`.github/workflows/release.yml`); to build locally:

```bash
# from the repo root, with the venv active
npm --prefix frontend ci && npm --prefix frontend run build
python packaging/fetch_models.py           # downloads the 3 default models
pip install pyinstaller
pyinstaller packaging/understudy.spec --noconfirm
```

Output:
- Windows → `packaging/dist/Understudy/Understudy.exe` (zip the whole folder)
- macOS → `packaging/dist/Understudy.app` (zip it)

Notes:
- Onedir (folder), not onefile — faster start and avoids AV false positives with
  onnxruntime/opencv.
- If a runtime `ModuleNotFoundError` appears, add the module to `hiddenimports`
  in `understudy.spec` and rebuild.
- The macOS `.icns` is optional (`packaging/understudy.icns`); without it the
  default icon is used.
- Builds are unsigned: Windows SmartScreen → *More info → Run anyway*; macOS →
  right-click → Open (or `xattr -dr com.apple.quarantine Understudy.app`).
