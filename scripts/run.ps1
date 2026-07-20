# Start Understudy (production mode: FastAPI serves the built SPA on one port).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path "$root\.venv\Scripts\python.exe")) {
    Write-Error "venv not found. Run scripts\setup.ps1 first."
}
if (-not (Test-Path "$root\frontend\dist\index.html")) {
    Write-Error "Frontend build not found. Run scripts\setup.ps1 first."
}

$url = "http://127.0.0.1:8000"
Write-Host "Starting Understudy at $url ..." -ForegroundColor Cyan
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process $using:url
} | Out-Null

Set-Location "$root\backend"
& "$root\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
