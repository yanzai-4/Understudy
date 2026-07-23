# Design: Downloadable Win/Mac app + release CI

Date: 2026-07-22
Status: Approved (design), pending implementation plan
Target: v1.6.0

## Problem

Today the only way to run Understudy is the source install (`setup.ps1` / `mac/setup.sh`): create a venv, install deps, build the UI, fetch models. That's fine for developers but a wall for the audience who just wants to *use* the app. We want a **download-from-Releases, double-click-to-run** app for Windows and macOS.

Feasibility is good: the dependency set is lean (**no PyTorch** — fastapi, uvicorn, numpy, opencv-python, rtmlib, onnxruntime, imageio-ffmpeg, psutil, pywebview, requests), so freezing with PyInstaller is practical.

## Goal

- A **standalone bundle** per platform, attached to the GitHub Release, that runs with no Python/Node/deps and **no model download on first run**.
- Built automatically by CI on a version tag.
- The existing source-install path stays unchanged as the developer path.

## Decisions (locked)

| # | Decision |
|---|----------|
| D1 | Frozen app splits **read-only bundled resources** (`resource_dir`) from a **writable user location** (`user_dir`). |
| D2 | Writable location = **OS user-data dir** when frozen: `%LOCALAPPDATA%\Understudy` (Windows), `~/Library/Application Support/Understudy` (macOS). Dev (source) is unchanged (repo root). |
| D3 | **PyInstaller, onedir** (not onefile) — reliable + fast start for onnxruntime/cv2; onefile's per-launch temp extraction is slow and trips AV. |
| D4 | **Bundle the three default models** (~64 MB: depth-int8, topformer_ade20k, yolox-tiny) + `frontend/dist` + assets. On first run, seed bundled models into the writable `models_dir`. yolox-l / depth-fp32 stay download-on-demand. |
| D5 | **Unsigned** artifacts for now; document the SmartScreen (Win) and Gatekeeper (Mac) one-time workarounds. Paid signing is a future option. |
| D6 | **CI on tag `v*`**: build Windows + macOS(arm) via GitHub Actions, zip, attach to the Release. |

## Path model (config.py)

The crux. Introduce `is_frozen = getattr(sys, "frozen", False)` and two roots:

- `resource_dir`:
  - frozen → `Path(sys._MEIPASS)` (PyInstaller unpack dir; for onedir this is the bundle's internal dir).
  - dev → repo root (`parents[2]` of config.py, as today).
- `user_dir`:
  - frozen → platform user-data dir (`%LOCALAPPDATA%\Understudy` / `~/Library/Application Support/Understudy`).
  - dev → repo root.

Rewire `Settings`:
- Under **`user_dir`**: `data_dir`, `films_dir`, `models_dir`, `db_path`, `user_mappings_path`.
- Under **`resource_dir`**: `frontend_dist` (`resource_dir/frontend/dist`), `builtin_mappings_path` (`resource_dir/backend/app/assets/prompt_mappings.json` when frozen; current path in dev), and a new `bundled_models_dir` (`resource_dir/models`).
- `ensure_dirs()` unchanged in spirit (creates the writable dirs).

**Dev is byte-for-byte unchanged**: `is_frozen` is false, both roots collapse to the repo root, every existing path resolves as before. Backend tests keep passing without modification.

## Model seeding

`model_manager.seed_bundled_models()`:
- For each managed model file present in `settings.bundled_models_dir` (matching its `relpath`), if the same file is absent in `settings.models_dir`, copy it over.
- Called once at startup (in `desktop.py` / app startup, before extraction is possible).
- Idempotent; a no-op in dev (no bundled dir) and after the first frozen run.

The extractor's existing `ensure_models` fallback still covers anything not bundled (downloads on demand into the writable dir).

## Packaging

`packaging/understudy.spec` (PyInstaller), entry `backend/desktop.py`:
- `datas`: `frontend/dist` → `frontend/dist`; `backend/app/assets` → `backend/app/assets`; the three default model files → `models/<relpath>`.
- `collect_all` for `onnxruntime`, `cv2`, `rtmlib`, `webview`; include the `imageio_ffmpeg` bundled ffmpeg binary; `hiddenimports` for uvicorn's dynamic pieces (`uvicorn.protocols.*`, `uvicorn.lifespan.*`, `uvicorn.loops.auto`).
- `multiprocessing.freeze_support()` at the top of `desktop.py`; uvicorn runs single-process, no reload (already the case).
- Windows: onedir → the app folder is zipped (`Understudy-windows.zip`); launcher exe named `Understudy`.
- macOS: `BUNDLE(... name="Understudy.app", icon=...)` reusing an `.icns` derived from `scripts/launcher` art; zipped (`Understudy-macos.zip`).

A thin build helper (`packaging/build.py` or per-OS scripts) wraps: `npm run build` (if needed) → `pyinstaller understudy.spec` → zip.

## CI

`.github/workflows/release.yml`, trigger `push: tags: ['v*']`:
- matrix: `windows-latest`, `macos-14`.
- steps: checkout → setup-python 3.11 → setup-node → `npm ci && npm run build` (frontend) → `pip install -r backend/requirements.txt pyinstaller` → `pyinstaller packaging/understudy.spec` → zip the dist → `softprops/action-gh-release` upload to the tag's Release.
- Models are fetched during the build (reuse `model_manager` download, or a small fetch step) so they're bundled.

## Docs

README gains a **"Download & run"** section above "Install & run":
- Windows: unzip → run `Understudy.exe`; on the SmartScreen prompt, *More info → Run anyway*.
- macOS: unzip → move `Understudy.app` to Applications → right-click → Open (first launch only), or `xattr -dr com.apple.quarantine Understudy.app`.
- Note: first run needs no download; extra quality models fetch on demand.

## Testing / verification

- Backend: add a `test_config_paths.py` — dev mode keeps repo-root paths; a monkeypatched frozen mode routes writable paths to a temp user dir and resources to a temp bundle dir. Add `test_seed_models` — copies a bundled file into an empty models dir, idempotent on second call.
- Windows: attempt the PyInstaller build locally to shake out hidden-import failures; launch once.
- macOS: **cannot be built/verified in this environment** — authored from standard PyInstaller/pywebview patterns; validated by the maintainer on a Mac and by the first CI run.

## Scope / out of scope

- In: config path layer, model seeding, PyInstaller spec, build helper, CI workflow, README download section, tests for the path layer + seeding.
- Out: paid code signing / notarization; auto-update; Linux builds; installers (.msi/.dmg) — plain zips for now.
