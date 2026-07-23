"""Desktop entry point: run the backend and show the React UI in a native
WebView2 window (via pywebview). Server and window live in ONE process, so
closing the window shuts the server down too — no lingering background process.

The window first shows a local "starting" page and only navigates to the app
once /api/health reports 200, so the user never sees a connection-refused page
during the (few-second) server boot. Launched by Understudy.exe.
"""

import multiprocessing
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

# Make `app` importable regardless of the working directory the launcher used.
BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

HOST = "127.0.0.1"
PORT = 8000
URL = f"http://{HOST}:{PORT}"

LOADING_HTML = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:#04070e;overflow:hidden;
    font-family:-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",system-ui,sans-serif}
  .wrap{position:fixed;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:18px;
    background-image:radial-gradient(900px 460px at 70% 20%,rgba(29,78,216,.14),transparent),
      radial-gradient(700px 400px at 25% 85%,rgba(56,189,248,.07),transparent)}
  .word{font-size:26px;font-weight:600;color:#e2e8f0}
  .word span{color:#38bdf8}
  .hint{font-size:12px;color:#64748b;letter-spacing:.02em}
  .bar{width:160px;height:2px;border-radius:2px;background:#1c2a4a;overflow:hidden}
  .bar i{display:block;height:100%;width:40%;border-radius:2px;
    background:linear-gradient(90deg,#3b82f6,#38bdf8);animation:slide 1.1s ease-in-out infinite}
  @keyframes slide{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
</style></head><body><div class="wrap">
  <svg width="76" height="76" viewBox="0 0 64 64" fill="none">
    <defs>
      <linearGradient id="s" x1="18" y1="18" x2="46" y2="46" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#3f7bf6"/></linearGradient>
      <linearGradient id="b" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#0c1526"/><stop offset="1" stop-color="#16233f"/></linearGradient>
    </defs>
    <rect width="64" height="64" rx="14" fill="url(#b)"/>
    <g stroke="#3a5488" stroke-width="2.1" stroke-linecap="round">
      <path d="M9 18v-5.5a3.5 3.5 0 0 1 3.5-3.5H18"/><path d="M46 9h5.5A3.5 3.5 0 0 1 55 12.5V18"/>
      <path d="M55 46v5.5a3.5 3.5 0 0 1-3.5 3.5H46"/><path d="M18 55h-5.5A3.5 3.5 0 0 1 9 51.5V46"/></g>
    <path d="M22.5 21 V33.5 A9.5 9.5 0 0 0 41.5 33.5 V21" stroke="url(#s)" stroke-width="5.6" stroke-linecap="round"/>
    <g><circle cx="22.5" cy="21" r="4.4" fill="#38bdf8" opacity=".35"/><circle cx="22.5" cy="21" r="2.8" fill="#eaf7ff"/></g>
    <g><circle cx="41.5" cy="21" r="4.4" fill="#38bdf8" opacity=".35"/><circle cx="41.5" cy="21" r="2.8" fill="#eaf7ff"/></g>
    <g><circle cx="32" cy="43" r="4.4" fill="#38bdf8" opacity=".35"/><circle cx="32" cy="43" r="2.8" fill="#eaf7ff"/></g>
  </svg>
  <div class="word">Under<span>study</span></div>
  <div class="bar"><i></i></div>
  <div class="hint">正在启动 · Starting…</div>
</div></body></html>"""

def _error_html() -> str:
    """Startup-failure page, pointing at the right recovery script per platform."""
    if sys.platform == "darwin":
        zh_cmd, en_cmd = "在终端运行 scripts/mac/run.sh", "run scripts/mac/run.sh in Terminal"
    else:
        zh_cmd, en_cmd = "在 PowerShell 运行 scripts\\run.ps1", "run scripts\\run.ps1 in PowerShell"
    return """<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#04070e;
  font-family:-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",system-ui,sans-serif;color:#cbd5e1}
  .w{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:10px;text-align:center;padding:0 40px}
  h1{font-size:18px;margin:0;color:#f1f5f9}p{font-size:13px;color:#64748b;margin:0;line-height:1.6}</style>
</head><body><div class="w"><h1>启动失败 · Failed to start</h1>
<p>服务未能在预期时间内就绪。请关闭本窗口后重试；<br>如反复出现，请""" + zh_cmd + """ 查看错误输出。</p>
<p>The backend did not become ready in time. Close this window and try again;<br>
if it persists, """ + en_cmd + """ to see the error.</p></div></body></html>"""


def _tcp_open(timeout: float = 0.3) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        return s.connect_ex((HOST, PORT)) == 0


def _health_ok(timeout: float = 1.0) -> bool:
    try:
        with urllib.request.urlopen(f"{URL}/api/health", timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def _run_server() -> None:
    import uvicorn

    # Pass the app object (not an "app.main:app" import string): a frozen build
    # has no importable module path, and reload is off anyway.
    from app.main import app as fastapi_app

    # A previous instance may still be releasing the port; wait briefly for it.
    for _ in range(40):
        if not _tcp_open():
            break
        time.sleep(0.25)
    try:
        uvicorn.run(fastapi_app, host=HOST, port=PORT, log_level="warning")
    except Exception:
        pass  # bind failed (another instance won the race) — health poll will find it


def _wait_for_health(deadline_sec: float) -> bool:
    end = time.time() + deadline_sec
    while time.time() < end:
        if _health_ok():
            return True
        time.sleep(0.4)
    return False


def main() -> None:
    import webview

    # Windows only: own taskbar identity (icon/grouping) instead of pythonw's.
    # On macOS the .app bundle provides the Dock identity and icon.
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Yanzai.Understudy")
        except Exception:
            pass

    storage = BACKEND_DIR.parent / "data" / "webview"
    storage.mkdir(parents=True, exist_ok=True)
    icon = BACKEND_DIR.parent / "scripts" / "launcher" / "understudy.ico"

    # Center the window on the primary screen.
    win_w, win_h = 1360, 960
    win_x = win_y = None
    try:
        screen = webview.screens[0]
        win_x = max(0, (screen.width - win_w) // 2)
        win_y = max(0, (screen.height - win_h) // 2)
    except Exception:
        pass

    # Open on a local "starting" page; navigate to the app only once healthy.
    window = webview.create_window(
        "Understudy",
        html=LOADING_HTML,
        width=win_w,
        height=win_h,
        x=win_x,
        y=win_y,
        min_size=(960, 700),
    )

    def boot(win) -> None:
        # Windows title-bar / taskbar icon via .NET (pythonnet). macOS gets its
        # icon from the .app bundle, so this is a no-op there.
        if sys.platform == "win32" and icon.exists():
            try:
                import clr

                clr.AddReference("System.Drawing")
                import System.Drawing  # noqa: PLC0415

                win.native.Icon = System.Drawing.Icon(str(icon))
            except Exception:
                pass

        # Start our own server unless a healthy instance is already serving.
        if not _health_ok(timeout=0.6):
            threading.Thread(target=_run_server, daemon=True).start()

        if _wait_for_health(deadline_sec=45):
            win.load_url(URL)  # the app plays its opening title on load
        else:
            win.load_html(_error_html())

    kwargs = {"private_mode": False, "storage_path": str(storage)}
    # Windows uses the .ico (also set on the native window in boot()); macOS
    # relies on the .app bundle, so don't pass a .ico there.
    if sys.platform == "win32" and icon.exists():
        kwargs["icon"] = str(icon)
    # Some pywebview backends reject certain kwargs; retry with the essentials.
    try:
        webview.start(boot, window, **kwargs)
    except TypeError:
        webview.start(boot, window)

    # Window closed: exit hard so the daemon server thread is torn down at once.
    sys.exit(0)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
