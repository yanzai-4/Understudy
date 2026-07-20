# Switch the inference backend between CPU (vanilla onnxruntime) and DirectML.
# The two packages are mutually exclusive in one environment, so a reinstall is required.
#
# Usage:
#   scripts\switch_directml.ps1            # switch to DirectML (Intel/AMD/NVIDIA GPU via DX12)
#   scripts\switch_directml.ps1 -ToCpu     # switch back to vanilla CPU onnxruntime
param([switch]$ToCpu)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$py = "$root\.venv\Scripts\python.exe"

if (-not (Test-Path $py)) { Write-Error "venv not found. Run scripts\setup.ps1 first." }

if ($ToCpu) {
    Write-Host "Switching to CPU (vanilla onnxruntime)..." -ForegroundColor Cyan
    & $py -m pip uninstall -y onnxruntime-directml onnxruntime
    & $py -m pip install "onnxruntime>=1.18"
} else {
    Write-Host "Switching to DirectML..." -ForegroundColor Cyan
    # rtmlib's dependency list pins vanilla onnxruntime, so reinstall it without deps
    # and provide the DirectML build instead (it bundles a full CPU fallback).
    & $py -m pip uninstall -y onnxruntime onnxruntime-directml
    & $py -m pip install onnxruntime-directml
    & $py -m pip install --no-deps --force-reinstall rtmlib
}

Write-Host "`nDone. Restart Understudy, then check Settings -> Hardware for available providers." -ForegroundColor Green
& $py -c "import onnxruntime as ort; print('available providers:', ort.get_available_providers())"
