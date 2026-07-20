# Understudy first-time setup: create the Python 3.11 venv, install backend deps,
# install frontend deps and build the SPA.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$py311 = "C:\Python311\python.exe"
if (-not (Test-Path $py311)) {
    Write-Error "Python 3.11 not found at $py311. Install Python 3.11 first (ML wheels do not support 3.14 yet)."
}

if (-not (Test-Path "$root\.venv")) {
    Write-Host "[1/5] Creating Python 3.11 venv..." -ForegroundColor Cyan
    & $py311 -m venv "$root\.venv"
} else {
    Write-Host "[1/5] venv already exists, skipping." -ForegroundColor DarkGray
}

Write-Host "[2/5] Installing backend dependencies..." -ForegroundColor Cyan
& "$root\.venv\Scripts\python.exe" -m pip install --upgrade pip -q
& "$root\.venv\Scripts\python.exe" -m pip install -r "$root\backend\requirements.txt"

Write-Host "[3/5] Installing frontend dependencies..." -ForegroundColor Cyan
Push-Location "$root\frontend"
npm install
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Error "npm install failed" }

Write-Host "[4/5] Building frontend..." -ForegroundColor Cyan
npm run build
$buildOk = $LASTEXITCODE -eq 0
Pop-Location
if (-not $buildOk) { Write-Error "npm run build failed" }

Write-Host "[5/5] Downloading extraction models (pose + depth)..." -ForegroundColor Cyan
Push-Location "$root\backend"
& "$root\.venv\Scripts\python.exe" -c "from app.services import model_manager; model_manager.download_required_cli()"
$modelsOk = $LASTEXITCODE -eq 0
Pop-Location
if (-not $modelsOk) {
    Write-Host "Model download failed — the app will retry automatically on first extraction." -ForegroundColor Yellow
}

Write-Host "`nSetup complete. Double-click Understudy.exe to start." -ForegroundColor Green
