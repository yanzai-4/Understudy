# Detached helper: wait for the app process to exit, swap the onnxruntime
# package for the target inference backend, then relaunch the app.
# Spawned by the backend when the user chooses "switch & auto-restart".
param(
    [Parameter(Mandatory = $true)][ValidateSet('cpu', 'directml')] [string]$Provider,
    [int]$WaitPid = 0
)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$py = "$root\.venv\Scripts\python.exe"
$log = "$root\data\switch_provider.log"
"`n[$(Get-Date -Format o)] switching to $Provider (waitpid=$WaitPid)" | Out-File $log -Append

# The in-use onnxruntime .pyd can't be replaced while the app runs, so wait
# for it to exit first (it stops itself right after responding).
if ($WaitPid -gt 0) {
    for ($i = 0; $i -lt 120; $i++) {
        if (-not (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 500
    }
}
Start-Sleep -Seconds 1

if ($Provider -eq 'directml') {
    & $py -m pip uninstall -y onnxruntime onnxruntime-directml *>> $log
    & $py -m pip install onnxruntime-directml *>> $log
    # rtmlib pins vanilla onnxruntime; reinstall it without deps so it keeps
    # using the DirectML build.
    & $py -m pip install --no-deps --force-reinstall rtmlib *>> $log
}
else {
    & $py -m pip uninstall -y onnxruntime-directml onnxruntime *>> $log
    & $py -m pip install "onnxruntime>=1.18" *>> $log
}

"[$(Get-Date -Format o)] reinstall finished (exit=$LASTEXITCODE), relaunching" | Out-File $log -Append
if (Test-Path "$root\Understudy.exe") {
    Start-Process "$root\Understudy.exe"
}
