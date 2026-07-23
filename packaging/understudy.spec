# PyInstaller spec — onedir bundle of the Understudy desktop app.
# Build:  pyinstaller packaging/understudy.spec --noconfirm
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH).resolve().parent  # packaging/ -> repo root
BACKEND = ROOT / "backend"

datas = [
    (str(ROOT / "frontend" / "dist"), "frontend/dist"),
    (str(BACKEND / "app" / "assets"), "backend/app/assets"),
    (str(ROOT / "packaging" / "models"), "models"),
]
binaries = []
hiddenimports = [
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "uvicorn.loops.auto",
]

# Native libs / data files these packages load dynamically.
for pkg in ("onnxruntime", "cv2", "rtmlib", "webview", "imageio_ffmpeg"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    [str(BACKEND / "desktop.py")],
    pathex=[str(BACKEND)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)
pyz = PYZ(a.pure)

_icon = ROOT / "scripts" / "launcher" / "understudy.ico"
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Understudy",
    console=False,
    icon=str(_icon) if (sys.platform == "win32" and _icon.exists()) else None,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Understudy")

if sys.platform == "darwin":
    _icns = ROOT / "packaging" / "understudy.icns"
    app = BUNDLE(
        coll,
        name="Understudy.app",
        bundle_identifier="com.yanzai.understudy",
        icon=str(_icns) if _icns.exists() else None,
    )
