# Downloadable App + Release CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship a double-click Windows/macOS app on the GitHub Release — no Python/Node/deps, no first-run model download — built automatically on a version tag. The source install stays the dev path.

**Architecture:** A frozen-aware path layer in `config.py` splits read-only bundled resources (`resource_dir`) from a writable user-data location (`user_dir`). PyInstaller (onedir) freezes `backend/desktop.py`, bundling `frontend/dist`, assets, and the three default models; bundled models are seeded into the writable dir on first run. GitHub Actions builds both OSes on tag `v*` and attaches zips to the Release.

**Tech Stack:** Python 3.11 / PyInstaller / GitHub Actions. Deps are lean (no torch): onnxruntime, opencv-python, numpy, rtmlib, imageio-ffmpeg, pywebview, fastapi/uvicorn.

## Global Constraints

- Run tests: `cd backend && ../.venv/Scripts/python -m pytest` (venv at repo root `.venv`, Python 3.11).
- **Dev behavior must not change**: when not frozen, `resource_dir == user_dir == repo root`, so every existing path resolves exactly as before and the current 107 backend tests keep passing untouched.
- Frozen detection: `getattr(sys, "frozen", False)`; PyInstaller resource root: `sys._MEIPASS`.
- Writable user dir (frozen): `%LOCALAPPDATA%\Understudy` (win), `~/Library/Application Support/Understudy` (mac), `$XDG_DATA_HOME/Understudy` else.
- Bundle only the three default models (depth-int8, topformer_ade20k, yolox_tiny). yolox_l / depth-fp32 stay download-on-demand.
- Commits: single author `Ryan Yan <ziyuan.yan2000@gmail.com>`, NO Claude co-author trailer. Branch `feature/packaging-release`.
- macOS build/run **cannot be verified in this environment**; author from standard patterns, verify Windows build locally, leave mac to the maintainer + first CI run.

---

### Task 1: Frozen-aware path layer (config.py)

Split resources from writable data; dev unchanged.

**Files:**
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_config_paths.py` (create)

**Interfaces produced:**
- `Settings.resource_dir` (read-only root), `Settings.user_dir` (writable root).
- `Settings.root_dir` property → alias of `resource_dir` (back-compat for `api/system.py`).
- writable: `data_dir`, `films_dir`, `models_dir`, `db_path`, `user_mappings_path` → under `user_dir`.
- read-only: `frontend_dist`, `builtin_mappings_path`, and new `bundled_models_dir` → under `resource_dir`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_config_paths.py`:

```python
import sys
from pathlib import Path

import app.config as cfg
from app.config import Settings, _resource_root, _user_root


def test_dev_mode_roots_collapse_to_repo_root():
    # not frozen → both roots == repo root (backend/app/config.py -> parents[2])
    repo = Path(cfg.__file__).resolve().parents[2]
    assert _resource_root() == repo
    assert _user_root() == repo


def test_dev_paths_unchanged():
    s = Settings(resource_dir=Path("/repo"), user_dir=Path("/repo"))
    assert s.data_dir == Path("/repo/data")
    assert s.models_dir == Path("/repo/models")
    assert s.frontend_dist == Path("/repo/frontend/dist")
    assert s.root_dir == Path("/repo")


def test_frozen_splits_resource_and_user():
    s = Settings(resource_dir=Path("/bundle"), user_dir=Path("/userdata"))
    # writable under user_dir
    assert s.data_dir == Path("/userdata/data")
    assert s.films_dir == Path("/userdata/data/films")
    assert s.models_dir == Path("/userdata/models")
    assert s.db_path == Path("/userdata/data/understudy.db")
    # read-only under resource_dir
    assert s.frontend_dist == Path("/bundle/frontend/dist")
    assert s.bundled_models_dir == Path("/bundle/models")
    assert s.root_dir == Path("/bundle")


def test_user_root_frozen_uses_appdata(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", r"C:\Users\x\AppData\Local")
    assert _user_root() == Path(r"C:\Users\x\AppData\Local") / "Understudy"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_config_paths.py -q`
Expected: FAIL — `_resource_root` / `_user_root` / `resource_dir` / `bundled_models_dir` don't exist.

- [ ] **Step 3: Rewrite config.py**

Replace `backend/app/config.py` with:

```python
import os
import sys
from pathlib import Path

from pydantic_settings import BaseSettings


def _is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def _resource_root() -> Path:
    """Read-only root: PyInstaller bundle when frozen, else the repo root."""
    if _is_frozen():
        meipass = getattr(sys, "_MEIPASS", None)
        return Path(meipass) if meipass else Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def _user_root() -> Path:
    """Writable root: an OS user-data dir when frozen, else the repo root."""
    if not _is_frozen():
        return Path(__file__).resolve().parents[2]
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    return base / "Understudy"


class Settings(BaseSettings):
    """Static app configuration. User-tunable options live in the settings DB table."""

    resource_dir: Path = _resource_root()  # read-only bundled files
    user_dir: Path = _user_root()  # writable data + models

    host: str = "127.0.0.1"
    port: int = 8000

    max_upload_bytes: int = 2 * 1024 * 1024 * 1024  # 2 GB
    default_page_size: int = 24
    max_page_size: int = 100

    default_max_size: int = 768
    auto_stride_target_frames: int = 300

    # Back-compat: source-tree scripts (provider switch) resolve from here. In a
    # frozen app this points at the read-only bundle, so those scripts aren't
    # found and api/system.py falls back to its manual-guidance message.
    @property
    def root_dir(self) -> Path:
        return self.resource_dir

    @property
    def data_dir(self) -> Path:
        return self.user_dir / "data"

    @property
    def films_dir(self) -> Path:
        return self.data_dir / "films"

    @property
    def models_dir(self) -> Path:
        return self.user_dir / "models"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "understudy.db"

    @property
    def frontend_dist(self) -> Path:
        return self.resource_dir / "frontend" / "dist"

    @property
    def bundled_models_dir(self) -> Path:
        return self.resource_dir / "models"

    @property
    def user_mappings_path(self) -> Path:
        return self.data_dir / "prompt_mappings.json"

    @property
    def builtin_mappings_path(self) -> Path:
        bundled = self.resource_dir / "backend" / "app" / "assets" / "prompt_mappings.json"
        return bundled if bundled.exists() else Path(__file__).resolve().parent / "assets" / "prompt_mappings.json"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.films_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
```

- [ ] **Step 4: Run tests + full backend suite**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_config_paths.py -q && ../.venv/Scripts/python -m pytest -q`
Expected: new tests PASS; the full suite still PASS (dev paths unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/tests/test_config_paths.py
git commit -m "feat(config): frozen-aware resource/user path split"
```

---

### Task 2: Seed bundled models on first run

**Files:**
- Modify: `backend/app/services/model_manager.py` (add `seed_bundled_models`)
- Modify: `backend/app/main.py` (call it at startup)
- Test: `backend/tests/test_seed_models.py` (create)

**Interfaces produced:**
- `seed_bundled_models() -> list[str]` — for each managed model whose file exists under `settings.bundled_models_dir/<relpath>` but not under `settings.models_dir/<relpath>`, copy it; returns the keys seeded. Idempotent; no-op in dev.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_seed_models.py`:

```python
from pathlib import Path

import app.config as cfg
from app.services import model_manager


def test_seed_copies_missing_and_is_idempotent(tmp_path, monkeypatch):
    bundle = tmp_path / "bundle" / "models"
    userm = tmp_path / "user" / "models"
    # one bundled model file laid out by its relpath
    key = "topformer_ade20k"
    rel = model_manager.MANAGED_MODELS[key]["relpath"]
    (bundle / Path(rel).parent).mkdir(parents=True)
    (bundle / rel).write_bytes(b"fake-onnx")

    monkeypatch.setattr(cfg.settings, "resource_dir", tmp_path / "bundle", raising=False)
    monkeypatch.setattr(cfg.settings, "user_dir", tmp_path / "user", raising=False)

    seeded = model_manager.seed_bundled_models()
    assert key in seeded
    assert (userm / rel).read_bytes() == b"fake-onnx"

    # second call copies nothing
    assert model_manager.seed_bundled_models() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_seed_models.py -q`
Expected: FAIL — `seed_bundled_models` does not exist.

- [ ] **Step 3: Implement `seed_bundled_models`**

Add to `backend/app/services/model_manager.py` (after `model_path`):

```python
import shutil


def seed_bundled_models() -> list[str]:
    """Copy any model bundled with a frozen build into the writable models dir
    (first-run, zero-download). Idempotent; a no-op from source (no bundle)."""
    bundled_root = settings.bundled_models_dir
    if not bundled_root.exists():
        return []
    seeded: list[str] = []
    for key, spec in MANAGED_MODELS.items():
        rel = spec.get("relpath")
        if not rel:
            continue
        src = bundled_root / rel
        dst = settings.models_dir / rel
        if src.exists() and not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            seeded.append(key)
    return seeded
```

(Ensure `from app.config import settings` is already imported in the module; it is used by `model_path`.)

- [ ] **Step 4: Wire into startup**

In `backend/app/main.py`, extend `on_startup` (after `settings.ensure_dirs()`):

```python
@app.on_event("startup")
def on_startup() -> None:
    settings.ensure_dirs()
    from app.services.model_manager import seed_bundled_models
    seed_bundled_models()
    init_db()
    _seed_demos_on_first_launch()
```

- [ ] **Step 5: Run test + full suite**

Run: `cd backend && ../.venv/Scripts/python -m pytest tests/test_seed_models.py -q && ../.venv/Scripts/python -m pytest -q`
Expected: PASS (both).

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/model_manager.py backend/app/main.py backend/tests/test_seed_models.py
git commit -m "feat(models): seed bundled models into the writable dir on first run"
```

---

### Task 3: Freeze-safe entry point

**Files:**
- Modify: `backend/desktop.py`

- [ ] **Step 1: freeze_support + run the app object (not an import string)**

At the very top of `backend/desktop.py`, after the imports, the module inserts `BACKEND_DIR` on `sys.path`. Add multiprocessing freeze support so a frozen child process can't re-spawn the GUI:

Add near the top (after `import sys`):

```python
import multiprocessing
```

In `_run_server`, replace the import-string form (which re-imports by name and is fragile when frozen) with the app object:

```python
def _run_server() -> None:
    import uvicorn

    from app.main import app as fastapi_app

    for _ in range(40):
        if not _tcp_open():
            break
        time.sleep(0.25)
    try:
        uvicorn.run(fastapi_app, host=HOST, port=PORT, log_level="warning")
    except Exception:
        pass
```

Find the `if __name__ == "__main__":` guard at the end of the file and make it call freeze support first:

```python
if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
```

- [ ] **Step 2: Verify dev still launches (smoke)**

Run (source mode, headless-ish check that it imports and the server boots): `cd backend && ../.venv/Scripts/python -c "import desktop; from app.main import app; print('import ok')"`
Expected: `import ok` (no import errors from the edits). Full GUI launch is verified during the Windows build in Task 4.

- [ ] **Step 3: Commit**

```bash
git add backend/desktop.py
git commit -m "chore(desktop): freeze_support + run the app object under uvicorn"
```

---

### Task 4: PyInstaller spec + build helper + model fetch

**Files:**
- Create: `packaging/understudy.spec`
- Create: `packaging/fetch_models.py`
- Create: `packaging/README.md` (how to build locally)
- Modify: `.gitignore` (ignore `packaging/models/`, `packaging/build/`, `packaging/dist/`)

- [ ] **Step 1: Model-fetch helper**

Create `packaging/fetch_models.py` — downloads the three default models into `packaging/models/<relpath>` so the spec can bundle them:

```python
"""Fetch the default models to bundle into the frozen app: packaging/models/<relpath>."""
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.services.model_manager import MANAGED_MODELS  # noqa: E402

BUNDLE = {"depth_int8", "topformer_ade20k", "yolox_tiny"}
OUT = Path(__file__).resolve().parent / "models"


def main() -> None:
    for key in BUNDLE:
        spec = MANAGED_MODELS[key]
        dst = OUT / spec["relpath"]
        if dst.exists():
            print(f"have {key}")
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading {key} <- {spec['url']}")
        urllib.request.urlretrieve(spec["url"], dst)
    print("done")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: PyInstaller spec**

Create `packaging/understudy.spec`:

```python
# PyInstaller spec — onedir bundle of the desktop app.
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH).resolve().parent  # repo root (packaging/ -> repo)
BACKEND = ROOT / "backend"

datas = [
    (str(ROOT / "frontend" / "dist"), "frontend/dist"),
    (str(BACKEND / "app" / "assets"), "backend/app/assets"),
    (str(ROOT / "packaging" / "models"), "models"),
]
binaries = []
hiddenimports = [
    "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on", "uvicorn.loops.auto",
]
for pkg in ("onnxruntime", "cv2", "rtmlib", "webview", "imageio_ffmpeg"):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h

a = Analysis(
    [str(BACKEND / "desktop.py")],
    pathex=[str(BACKEND)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Understudy",
          console=False, icon=str(ROOT / "scripts" / "launcher" / "understudy.ico") if sys.platform == "win32" else None)
coll = COLLECT(exe, a.binaries, a.datas, name="Understudy")

if sys.platform == "darwin":
    app = BUNDLE(coll, name="Understudy.app", bundle_identifier="com.yanzai.understudy",
                 icon=str(ROOT / "packaging" / "understudy.icns") if (ROOT / "packaging" / "understudy.icns").exists() else None)
```

Note: on macOS an `.icns` is optional; if `packaging/understudy.icns` is absent PyInstaller uses a default icon (fine for v1.6.0). Generating `.icns` from the existing PNG art is a follow-up.

- [ ] **Step 3: gitignore + packaging README**

Append to `.gitignore`:
```
packaging/models/
packaging/build/
packaging/dist/
*.spec.bak
```

Create `packaging/README.md`:
```markdown
# Building the desktop app

    # from the repo root, with the venv active and frontend built
    npm --prefix frontend ci && npm --prefix frontend run build
    python packaging/fetch_models.py
    pip install pyinstaller
    pyinstaller packaging/understudy.spec --noconfirm

Output: `packaging/dist/Understudy/` (Windows) or `packaging/dist/Understudy.app` (macOS).
Zip that and attach to a GitHub Release, or let CI do it on a `v*` tag.
```

- [ ] **Step 4: Local Windows build (verification — best effort)**

Run from repo root:
```bash
npm --prefix frontend run build
.venv/Scripts/python packaging/fetch_models.py
.venv/Scripts/python -m pip install pyinstaller
.venv/Scripts/pyinstaller packaging/understudy.spec --noconfirm
```
Expected: `packaging/dist/Understudy/Understudy.exe` exists. Launch it once and confirm the window opens and reaches the app (health OK). If PyInstaller reports a missing module at runtime, add it to `hiddenimports` and rebuild. Record any additions.

- [ ] **Step 5: Commit**

```bash
git add packaging/ .gitignore
git commit -m "build: PyInstaller onedir spec + model-fetch helper for the desktop app"
```

---

### Task 5: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            artifact: Understudy-windows.zip
          - os: macos-14
            artifact: Understudy-macos.zip
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - name: Build frontend
        run: npm --prefix frontend ci && npm --prefix frontend run build

      - name: Install Python deps
        run: |
          python -m pip install --upgrade pip
          pip install -r backend/requirements.txt pyinstaller

      - name: Fetch bundled models
        run: python packaging/fetch_models.py

      - name: PyInstaller
        run: pyinstaller packaging/understudy.spec --noconfirm

      - name: Zip (Windows)
        if: runner.os == 'Windows'
        run: Compress-Archive -Path packaging/dist/Understudy/* -DestinationPath ${{ matrix.artifact }}
      - name: Zip (macOS)
        if: runner.os == 'macOS'
        run: cd packaging/dist && zip -r ../../${{ matrix.artifact }} Understudy.app

      - name: Attach to release
        uses: softprops/action-gh-release@v2
        with:
          files: ${{ matrix.artifact }}
```

- [ ] **Step 2: Sanity-check YAML**

Run: `cd /c/Users/20117/Desktop/Understudy && ../.venv/Scripts/python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')"` (or any YAML validator available).
Expected: `yaml ok`. (Full CI is validated only by pushing a tag — the maintainer's step.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: build + attach win/mac app to the GitHub Release on v* tags"
```

---

### Task 6: README "Download & run" + finalize

**Files:**
- Modify: `README.md`
- Modify: `backend/app/__init__.py`, `frontend/package.json` (version → 1.6.0)

- [ ] **Step 1: README download section**

In `README.md`, add a new section immediately before `## Install & run`:

```markdown
## Download & run (no setup)

Grab the latest build from [Releases](https://github.com/yanzai-4/Understudy/releases) — no Python, Node, or model download needed.

- **Windows**: unzip, run `Understudy.exe`. First launch shows a SmartScreen prompt ("unknown publisher") → **More info → Run anyway** (unsigned build).
- **macOS**: unzip, drag `Understudy.app` to Applications, then **right-click → Open** the first time (or run `xattr -dr com.apple.quarantine Understudy.app`) — the build isn't notarized.

Your films, exports and any extra models live in a user-data folder (`%LOCALAPPDATA%\Understudy` on Windows, `~/Library/Application Support/Understudy` on macOS). Prefer to build from source or hack on it? See **Install & run** below.
```

- [ ] **Step 2: Version bump**

`backend/app/__init__.py` → `__version__ = "1.6.0"`; `frontend/package.json` → `"version": "1.6.0"`.

- [ ] **Step 3: Full verification**

Run: `cd backend && ../.venv/Scripts/python -m pytest -q && cd ../frontend && npm run build`
Expected: backend PASS, frontend build PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md backend/app/__init__.py frontend/package.json
git commit -m "docs: download-and-run section; bump to 1.6.0"
```

---

## Self-Review

**Spec coverage:** D1/D2 path split → Task 1. D3 onedir + D4 bundle/seed → Tasks 2, 4. D5 unsigned + docs → Task 6. D6 CI on tag → Task 5. Freeze-safety → Task 3. ✅

**Placeholder scan:** none. `.icns` generation is explicitly deferred (default icon used), not a placeholder.

**Type/name consistency:** `resource_dir`/`user_dir`/`bundled_models_dir`/`seed_bundled_models` used identically across config, model_manager, tests, and the spec's `datas` (`models` maps to `resource_dir/models`). `fetch_models.py` writes `packaging/models/<relpath>`; the spec bundles `packaging/models` → `models`; `bundled_models_dir` reads `resource_dir/models` — consistent.

**Verification limits:** Windows build is attempted locally (Task 4 Step 4); macOS is authored-not-run and validated by the maintainer + first CI run (stated in Global Constraints).
