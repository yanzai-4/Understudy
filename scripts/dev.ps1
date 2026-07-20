# Development mode: FastAPI on :8000 (reload) + Vite dev server on :5173 (HMR).
# Open http://localhost:5173 while developing.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path "$root\.venv\Scripts\python.exe")) {
    Write-Error "venv not found. Run scripts\setup.ps1 first."
}

Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$root\backend'; & '$root\.venv\Scripts\python.exe' -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
)

Set-Location "$root\frontend"
npm run dev
