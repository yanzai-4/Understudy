"""Render docs/hero.html to a crisp docs/hero.png (2x) via headless Chrome.

The logo is vector, so this produces a sharp banner at any DPI. Run whenever
the branding changes:  python scripts/launcher/render_hero.py
"""
import asyncio
import base64
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets  # already a dependency of the screenshot tooling

ROOT = Path(__file__).resolve().parents[2]
HTML = (ROOT / "docs" / "hero.html").as_uri()
OUT = ROOT / "docs" / "hero.png"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9911
W, H, SCALE = 1200, 470, 2


async def cdp(ws, method, params=None, _id=[0]):
    _id[0] += 1
    i = _id[0]
    await ws.send(json.dumps({"id": i, "method": method, "params": params or {}}))
    while True:
        msg = json.loads(await ws.recv())
        if msg.get("id") == i:
            return msg.get("result", {})


async def main():
    proc = subprocess.Popen([
        CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        f"--window-size={W},{H}",
        f"--remote-debugging-port={PORT}", "--user-data-dir=" + tempfile.mkdtemp(prefix="understudy-hero-"),
        HTML,
    ])
    try:
        ws_url = None
        for _ in range(40):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
                pages = [t for t in tabs if t["type"] == "page" and t.get("webSocketDebuggerUrl")]
                if pages:
                    ws_url = pages[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                pass
            time.sleep(0.3)
        async with websockets.connect(ws_url, max_size=None) as ws:
            await cdp(ws, "Runtime.enable")
            await asyncio.sleep(1.5)
            shot = await cdp(ws, "Page.captureScreenshot", {
                "format": "png",
                "clip": {"x": 0, "y": 0, "width": W, "height": H, "scale": SCALE},
            })
            OUT.write_bytes(base64.b64decode(shot["data"]))
            print(f"wrote {OUT} ({W * SCALE}x{H * SCALE})")
    finally:
        proc.terminate()


asyncio.run(main())
